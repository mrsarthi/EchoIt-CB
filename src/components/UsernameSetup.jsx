import { useState } from 'react';
import { AtSign, ChevronRight } from 'lucide-react';
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
                localStorage.setItem('decentrachat_username', result.username);
                onComplete(result.username);
            } else {
                setError(result.error || 'Failed to set username');
            }
        } catch {
            setError('Connection error. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <main className="username-setup-container">
            <div className="username-card animate-fadeIn">
                <div className="username-header">
                    <div className="icon-badge">
                        <AtSign size={24} className="text-primary" />
                    </div>
                    <h2>Secure Identity</h2>
                    <p className="text-secondary">
                        Choose a unique handle for your decentralized profile.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="username-form">
                    <div className="input-field">
                        <AtSign size={18} className="input-icon" />
                        <input
                            type="text"
                            className="username-input"
                            placeholder="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            maxLength={20}
                            autoFocus
                        />
                    </div>

                    <p className="input-hint">
                        3-20 characters • Alphanumeric & underscores
                    </p>

                    {error && (
                        <div className="error-message">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary full-width"
                        disabled={isSubmitting || username.length < 3}
                    >
                        {isSubmitting ? (
                            <div className="spinner-small"></div>
                        ) : (
                            <>Continue <ChevronRight size={18} /></>
                        )}
                    </button>
                </form>
            </div>
        </main>
    );
}
