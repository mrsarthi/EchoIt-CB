import { useState, useEffect } from 'react';
import './PINModal.css';

/**
 * PINModal - Component for setting up or entering a security PIN
 * @param {Object} props
 * @param {boolean} props.isSetup - Whether this is for first-time PIN setup
 * @param {Function} props.onSubmit - Callback when PIN is submitted
 * @param {Function} props.onReset - Callback for app data reset
 * @param {string} props.error - External error message
 */
export default function PINModal({ isSetup, onSubmit, onReset, error: externalError }) {
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (externalError) {
            setError(externalError);
        }
    }, [externalError]);

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');

        if (pin.length < 4) {
            setError('PIN must be at least 4 digits');
            return;
        }

        if (isSetup && pin !== confirmPin) {
            setError('PINs do not match');
            return;
        }

        onSubmit(pin);
    };

    return (
        <div className="pin-modal-overlay">
            <div className="pin-modal-card">
                <div className="pin-modal-icon">
                    {isSetup ? '🔐' : '🔓'}
                </div>
                <h2 className="pin-modal-title">
                    {isSetup ? 'Setup Security PIN' : 'Enter Security PIN'}
                </h2>
                <p className="pin-modal-description">
                    {isSetup 
                        ? 'Create a PIN to encrypt your private keys locally. You will need this to unlock your chat history on this device.' 
                        : 'Your local chat keys are encrypted. Enter your PIN to unlock them.'}
                </p>

                <form onSubmit={handleSubmit}>
                    <div className="pin-input-group">
                        <input
                            type="password"
                            className="pin-input"
                            placeholder="PIN"
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                            autoFocus
                            maxLength={8}
                        />
                    </div>

                    {isSetup && (
                        <div className="pin-input-group">
                            <input
                                type="password"
                                className="pin-input"
                                placeholder="Confirm PIN"
                                value={confirmPin}
                                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                                maxLength={8}
                            />
                        </div>
                    )}

                    {error && <div className="pin-error">{error}</div>}

                    <div className="pin-modal-actions">
                        <button type="submit" className="pin-submit-btn">
                            {isSetup ? 'Setup PIN' : 'Unlock Keys'}
                        </button>
                        
                        {!isSetup && (
                            <button 
                                type="button" 
                                className="pin-reset-btn"
                                onClick={() => {
                                    if (window.confirm('WARNING: Resetting app data will clear all local keys and history. You will need to re-log with your wallet. Continue?')) {
                                        onReset();
                                    }
                                }}
                            >
                                Forgot PIN? Reset App Data
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
}
