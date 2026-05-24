import { useState, useRef } from 'react';
import { Camera, User, Check, Copy, X, Trash2 } from 'lucide-react';
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
    const [copied, setCopied] = useState(false);
    const fileInputRef = useRef(null);

    const handleCopyId = () => {
        try {
            navigator.clipboard.writeText(walletAddress);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error(err);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                const MAX_SIZE = 400;
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

                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
                setAvatar(compressedBase64);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        onSave(avatar, status.trim());
        setIsSaving(false);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content profile-modal animate-scaleIn" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Edit Profile</h2>
                    <button className="btn btn-ghost" onClick={onClose}><X size={24} /></button>
                </div>
                
                <form onSubmit={handleSubmit} className="profile-form">
                    <div className="profile-avatar-section">
                        <div className="profile-avatar-wrapper" onClick={() => fileInputRef.current?.click()}>
                            {avatar ? (
                                <img src={avatar} alt="Avatar" className="profile-avatar-img" />
                            ) : (
                                <div className="profile-avatar-placeholder">
                                    <User size={40} />
                                </div>
                            )}
                            <div className="avatar-edit-overlay">
                                <Camera size={20} />
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
                            <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => setAvatar(null)}>
                                <Trash2 size={14} /> Remove Photo
                            </button>
                        )}
                    </div>

                    <div className="settings-group">
                        <label className="settings-group-title">Display Name</label>
                        <input 
                            type="text" 
                            className="input" 
                            value={username || 'Anonymous'} 
                            disabled 
                        />
                        <p className="input-hint">Your blockchain handle is permanent</p>
                    </div>

                    <div className="settings-group">
                        <label className="settings-group-title">Status Message</label>
                        <input 
                            type="text" 
                            className="input" 
                            placeholder="How are you feeling?" 
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                            maxLength={50}
                        />
                    </div>

                    <div className="settings-group">
                        <label className="settings-group-title">Blockchain Identity</label>
                        <div className="wallet-pill full-width" onClick={handleCopyId}>
                            <code>{walletAddress?.slice(0, 16)}...{walletAddress?.slice(-14)}</code>
                            {copied ? <Check size={14} className="text-trust" /> : <Copy size={14} />}
                        </div>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary flex-1" disabled={isSaving}>
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
