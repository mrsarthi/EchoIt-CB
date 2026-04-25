import { useState, useRef } from 'react';
import { generateDiscussionId, formatDiscussionId } from '../services/identityService';
import './ProfileModal.css';

export function ProfileModal({ 
    walletAddress, 
    username, 
    currentAvatar, 
    currentStatus, 
    onSave, 
    onClose 
}) {
    const [avatar, setAvatar] = useState(currentAvatar || null);
    const [status, setStatus] = useState(currentStatus || '');
    const [isSaving, setIsSaving] = useState(false);
    const fileInputRef = useRef(null);

    const handleCopyId = () => {
        try {
            navigator.clipboard.writeText(walletAddress);
            alert('Address copied to clipboard! 📋');
        } catch (err) {
            console.error(err);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Basic validation
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }

        // Compress image to base64
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Max dimensions
                const MAX_SIZE = 200;
                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Use high compression JPEG
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
                setAvatar(compressedBase64);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    const handleRemoveAvatar = () => {
        setAvatar(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        // Call saveProfile on useChat hook
        onSave(avatar, status.trim());
        setIsSaving(false);
        onClose();
    };

    return (
        <div className="modal-overlay animate-fadeIn" onClick={onClose}>
            <div className="modal-content glass-card zoomIn" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Profile Settings</h2>
                    <button className="btn-icon" onClick={onClose}>✕</button>
                </div>
                
                <form onSubmit={handleSubmit} className="profile-form">
                    <div className="profile-avatar-section">
                        <div className="profile-avatar-preview" onClick={() => fileInputRef.current?.click()}>
                            {avatar ? (
                                <img src={avatar} alt="Avatar" className="profile-avatar-img" />
                            ) : (
                                <div className="profile-avatar-placeholder">
                                    {(username && username.length > 1) ? username.replace('@', '')[0]?.toUpperCase() : (walletAddress ? walletAddress.slice(2, 4).toUpperCase() : 'U')}
                                </div>
                            )}
                            <div className="profile-avatar-overlay">
                                <span>📷 Edit</span>
                            </div>
                        </div>
                        <input 
                            type="file" 
                            accept="image/*" 
                            ref={fileInputRef} 
                            onChange={handleFileChange} 
                            style={{ display: 'none' }} 
                        />
                        {avatar && (
                            <button type="button" className="btn btn-danger btn-sm mt-2" onClick={handleRemoveAvatar}>
                                Remove Photo
                            </button>
                        )}
                    </div>

                    <div className="input-group">
                        <label>Username (Read-only)</label>
                        <input 
                            type="text" 
                            className="input" 
                            value={username || 'Anonymous'} 
                            disabled 
                            style={{ opacity: 0.7 }}
                        />
                    </div>

                    <div className="input-group">
                        <label>Status Tagline</label>
                        <input 
                            type="text" 
                            className="input" 
                            placeholder="Available, Busy, etc..." 
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                            maxLength={50}
                        />
                        <span className="text-xs text-muted" style={{ display: 'block', textAlign: 'right', marginTop: '4px' }}>
                            {status.length}/50
                        </span>
                    </div>

                    <div className="profile-id-section">
                        <label>Your Discussion ID</label>
                        <div className="profile-id-box" onClick={() => {
                            const dId = generateDiscussionId(walletAddress);
                            navigator.clipboard.writeText(dId).then(() => alert('Discussion ID copied! 📋'));
                        }} title="Click to copy">
                            <span className="profile-id-text" style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.5px' }}>
                                {formatDiscussionId(generateDiscussionId(walletAddress))}
                            </span>
                            <button type="button" className="btn-icon">📋</button>
                        </div>
                        <span className="text-xs text-muted" style={{ marginTop: '4px', display: 'block' }}>
                            Share this ID with others to connect
                        </span>
                    </div>

                    <div className="profile-id-section">
                        <label>Wallet Address</label>
                        <div className="profile-id-box" onClick={handleCopyId} title="Click to copy">
                            <span className="profile-id-text">{walletAddress}</span>
                            <button type="button" className="btn-icon">📋</button>
                        </div>
                    </div>

                    <div className="modal-actions" style={{ marginTop: '24px' }}>
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={isSaving}>
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
