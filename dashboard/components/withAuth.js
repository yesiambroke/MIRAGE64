import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AUTH_CONFIG } from '../config/auth';

const withAuth = (WrappedComponent) => {
  return function WithAuth(props) {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
      // Check if we're in the browser
      if (typeof window !== 'undefined') {
        const checkAuth = () => {
          const isAuthenticated = localStorage.getItem(AUTH_CONFIG.session.keys.isAuthenticated) === 'true';
          const lastActivity = parseInt(localStorage.getItem(AUTH_CONFIG.session.keys.lastActivity) || '0');
          const now = Date.now();
          
          // Check if session has timed out
          if (isAuthenticated && (now - lastActivity > AUTH_CONFIG.session.timeout)) {
            // Clear auth state
            Object.values(AUTH_CONFIG.session.keys).forEach(key => {
              localStorage.removeItem(key);
            });
            router.replace(AUTH_CONFIG.routes.login);
            return;
          }
          
          // Update last activity
          if (isAuthenticated) {
            localStorage.setItem(AUTH_CONFIG.session.keys.lastActivity, now.toString());
          }
          
          if (!isAuthenticated) {
            router.replace(AUTH_CONFIG.routes.login);
          } else {
            setIsLoading(false);
          }
        };

        // Initial check
        checkAuth();

        // Set up activity listeners to update lastActivity
        const updateLastActivity = () => {
          if (localStorage.getItem(AUTH_CONFIG.session.keys.isAuthenticated) === 'true') {
            localStorage.setItem(AUTH_CONFIG.session.keys.lastActivity, Date.now().toString());
          }
        };

        // Add event listeners for user activity
        window.addEventListener('mousemove', updateLastActivity);
        window.addEventListener('keydown', updateLastActivity);
        window.addEventListener('click', updateLastActivity);
        window.addEventListener('scroll', updateLastActivity);

        // Set up periodic session check
        const sessionCheckInterval = setInterval(checkAuth, 60000); // Check every minute

        return () => {
          // Clean up event listeners
          window.removeEventListener('mousemove', updateLastActivity);
          window.removeEventListener('keydown', updateLastActivity);
          window.removeEventListener('click', updateLastActivity);
          window.removeEventListener('scroll', updateLastActivity);
          clearInterval(sessionCheckInterval);
        };
      }
    }, [router]);

    // Show loading state while checking authentication
    if (isLoading) {
      return (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: '#1a202c',
          color: '#00ff9d',
          fontFamily: 'monospace',
          fontSize: '1.2rem',
          textShadow: '0 0 10px rgba(0, 255, 157, 0.5)',
        }}>
          <div style={{
            position: 'relative',
            padding: '1rem',
            border: '1px solid rgba(0, 255, 157, 0.2)',
            borderRadius: '0.5rem',
            background: 'rgba(31, 41, 55, 0.8)',
            backdropFilter: 'blur(8px)',
          }}>
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(0, 255, 157, 0.5), transparent)',
              animation: 'scanline 2s linear infinite',
            }} />
            Loading...
          </div>
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };
};

export default withAuth; 