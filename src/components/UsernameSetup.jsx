// UsernameSetup Component - First-time username selection
import { useState } from 'react';
import { setUsername as setUsernameOnServer } from '../services/socketService';
import './UsernameSetup.css';

export function UsernameSetup({ onComplete }) {
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const trimmed = username.trim();

        // Client-side validation
        if (trimmed.length < 3) {
            setError('Username must be at least 3 characters');
            return;
        }
        if (trimmed.length > 20) {
            setError('Username must be 20 characters or less');
            return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            setError('Only letters, numbers, and underscores allowed');
            return;
        }

        setIsSubmitting(true);

        try {
            const result = await setUsernameOnServer(trimmed);

            if (result.success) {
                // Save to localStorage
                localStorage.setItem('decentrachat_username', result.username);
                onComplete(result.username);
            } else {
                setError(result.error || 'Failed to set username');
            }
        } catch (err) {
            setError('Connection error. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="username-setup-container">
            <div className="username-card glass-card animate-fadeIn">
                <div className="username-header">
                    <span className="username-icon">🏷️</span>
                    <h2>Choose Your Username</h2>
                    <p className="text-secondary">
                        Your friends can find you using this tag
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="username-form">
                    <div className="input-wrapper">
                        <span className="input-prefix">@</span>
                        <input
                            type="text"
                            className="input username-input"
                            placeholder="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            maxLength={20}
                            autoFocus
                        />
                    </div>

                    <p className="input-hint text-muted">
                        3-20 characters, letters, numbers, underscores only
                    </p>

                    {error && (
                        <div className="error-message animate-fadeIn">
                            {error}
                        </div>
                    )}

                    <div className="username-actions">
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={isSubmitting || username.length < 3}
                        >
                            {isSubmitting ? (
                                <>
                                    <span className="spinner"></span>
                                    Saving...
                                </>
                            ) : (
                                'Set Username'
                            )}
                        </button>


                    </div>
                </form>
            </div>
        </div>
    );
}
