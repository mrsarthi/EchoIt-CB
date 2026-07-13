import React from 'react';
import logo from './assets/logo.png';

export default function SplashScreen({ phase, error }) {
  // Translate internal phases to user-friendly messages
  const phaseMessages = {
    checking_crypto: 'Verifying secure cryptographic environment...',
    loading_keys: 'Decrypting and loading secure local keys...',
    connecting: 'Establishing connection to secure relay...',
    error: 'Initialization failed.'
  };

  const getStepStatus = (stepPhase) => {
    const phasesOrder = ['checking_crypto', 'loading_keys', 'connecting', 'ready'];
    const currentIdx = phasesOrder.indexOf(phase);
    const stepIdx = phasesOrder.indexOf(stepPhase);
    
    if (error && phase === stepPhase) return 'error';
    if (currentIdx > stepIdx) return 'completed';
    if (currentIdx === stepIdx) return 'active';
    return 'pending';
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoContainer}>
          <img src={logo} alt="EchoIt Logo" style={error ? styles.logoStatic : styles.logoPulsing} />
        </div>
        
        <h1 style={styles.title}>EchoIt Messenger</h1>
        <p style={styles.subtitle}>Decentralized & End-to-End Encrypted</p>

        {error ? (
          <div style={styles.errorBox}>
            <span style={styles.errorIcon}>⚠️</span>
            <div style={styles.errorText}>
              {error === 'CRYPTO_UNAVAILABLE' 
                ? 'Your browser does not support required Web Crypto APIs. Please use a modern browser (Chrome, Firefox, Safari) over a secure origin (HTTPS).'
                : `Error initializing database: ${error}`}
            </div>
          </div>
        ) : (
          <div style={styles.checklist}>
            <div style={styles.checkItem(getStepStatus('checking_crypto'))}>
              <span style={styles.bullet(getStepStatus('checking_crypto'))}>
                {getStepStatus('checking_crypto') === 'completed' ? '✓' : '●'}
              </span>
              <span>Verify secure environment</span>
            </div>
            
            <div style={styles.checkItem(getStepStatus('loading_keys'))}>
              <span style={styles.bullet(getStepStatus('loading_keys'))}>
                {getStepStatus('loading_keys') === 'completed' ? '✓' : '●'}
              </span>
              <span>Load local security credentials</span>
            </div>
            
            <div style={styles.checkItem(getStepStatus('connecting'))}>
              <span style={styles.bullet(getStepStatus('connecting'))}>
                {getStepStatus('connecting') === 'completed' ? '✓' : '●'}
              </span>
              <span>Connect to signaling network</span>
            </div>
          </div>
        )}

        <div style={styles.loaderBarContainer}>
          {!error && (
            <div style={styles.loaderBar(phase)} />
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: '#0b0f19', // Sleek dark mode base
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: '#f3f4f6',
    margin: 0,
    padding: '20px',
    boxSizing: 'border-box'
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    padding: '40px 30px',
    borderRadius: '24px',
    backgroundColor: 'rgba(17, 24, 39, 0.6)', // Glassmorphism
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
    backdropFilter: 'blur(16px)',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  logoContainer: {
    width: '80px',
    height: '80px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  logoPulsing: {
    width: '72px',
    height: '72px',
    objectFit: 'contain',
    animation: 'pulse 1.8s infinite ease-in-out'
  },
  logoStatic: {
    width: '72px',
    height: '72px',
    objectFit: 'contain'
  },
  title: {
    fontSize: '24px',
    fontWeight: '700',
    margin: '0 0 4px 0',
    letterSpacing: '-0.025em',
    background: 'linear-gradient(135deg, #a7f3d0, #10b981)', // Vibrant gradient
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent'
  },
  subtitle: {
    fontSize: '13px',
    color: '#9ca3af',
    margin: '0 0 32px 0',
    fontWeight: '400'
  },
  checklist: {
    width: '100%',
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '32px'
  },
  checkItem: (status) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px',
    fontWeight: status === 'active' ? '500' : '400',
    color: status === 'completed' 
      ? '#10b981' 
      : status === 'active' 
        ? '#f3f4f6' 
        : '#4b5563',
    transition: 'all 0.3s ease'
  }),
  bullet: (status) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    fontSize: status === 'completed' ? '12px' : '8px',
    backgroundColor: status === 'completed' 
      ? 'rgba(16, 185, 129, 0.15)' 
      : status === 'active' 
        ? 'rgba(255, 255, 255, 0.1)' 
        : 'transparent',
    border: status === 'pending' ? '1px solid #374151' : 'none',
    color: status === 'completed' ? '#10b981' : status === 'active' ? '#a7f3d0' : '#4b5563',
    transition: 'all 0.3s ease',
    animation: status === 'active' ? 'pulse 1.2s infinite ease-in-out' : 'none'
  }),
  errorBox: {
    width: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    padding: '16px',
    borderRadius: '16px',
    textAlign: 'left',
    marginBottom: '24px'
  },
  errorIcon: {
    fontSize: '20px',
    lineHeight: '1'
  },
  errorText: {
    fontSize: '13px',
    color: '#fca5a5',
    lineHeight: '1.4'
  },
  loaderBarContainer: {
    width: '100%',
    height: '4px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  loaderBar: (phase) => {
    const widths = {
      checking_crypto: '25%',
      loading_keys: '60%',
      connecting: '90%',
      ready: '100%'
    };
    return {
      height: '100%',
      width: widths[phase] || '0%',
      backgroundColor: '#10b981',
      borderRadius: '2px',
      boxShadow: '0 0 8px #10b981',
      transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
    };
  }
};

// CSS animations injector
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 0.6; transform: scale(0.96); }
      50% { opacity: 1; transform: scale(1.04); }
    }
  `;
  document.head.appendChild(style);
}
