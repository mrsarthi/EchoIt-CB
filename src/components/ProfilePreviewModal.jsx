import React from 'react';
import { 
    X, 
    Calendar, 
    Shield, 
    Activity, 
    MessageSquare, 
    User,
    Lock
} from 'lucide-react';
import { formatAddress } from '../blockchain/web3Provider';
import './ProfilePreviewModal.css';
import { TrustBadge } from './TrustBadge';

export function ProfilePreviewModal({ user, onClose, onStartChat }) {
    if (!user) return null;

    const displayName = user.username || formatAddress(user.address);
    const isOnline = user.online;
    const memberSince = user.registeredAt || user.joinedAt;

    const formatDate = (ts) => {
        if (!ts) return 'Unknown';
        const date = new Date(ts);
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    };

    return (
        <div className="modal-overlay animate-fadeIn" onClick={onClose}>
            <div className="profile-preview-card animate-scaleIn" onClick={e => e.stopPropagation()}>
                <button className="btn btn-ghost close-btn" onClick={onClose}>
                    <X size={24} />
                </button>
                
                <div className="profile-preview-header">
                    <div className="avatar avatar-xxl">
                        {user.avatar ? (
                            <img src={user.avatar} alt="Avatar" />
                        ) : (
                            <div className="avatar-placeholder">
                                <User size={40} />
                            </div>
                        )}
                        <span className={`status-badge ${isOnline ? 'online' : 'offline'}`}></span>
                    </div>
                    
                    <div className="profile-preview-identity">
                        <h2>{displayName}</h2>
                        {user.username && <p className="text-secondary text-sm">@{user.username}</p>}
                    </div>

                    {user.status && (
                        <div className="profile-preview-status">
                            <p>"{user.status}"</p>
                        </div>
                    )}
                </div>

                <div className="profile-preview-grid">
                    <div className="preview-stat-item">
                        <Calendar size={18} className="text-muted" />
                        <div className="stat-content">
                            <span className="stat-label">Member Since</span>
                            <span className="stat-value">{formatDate(memberSince)}</span>
                        </div>
                    </div>
                    <div className="preview-stat-item">
                        <Shield size={18} className="text-trust" />
                        <div className="stat-content">
                            <span className="stat-label">Identity Status</span>
                            <TrustBadge stage={user.trustStage || 1} />
                        </div>
                    </div>
                    <div className="preview-stat-item">
                        <Activity size={18} className={isOnline ? 'text-trust' : 'text-muted'} />
                        <div className="stat-content">
                            <span className="stat-label">Presence</span>
                            <span className="stat-value">{isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                </div>

                <div className="profile-preview-actions">
                    <button 
                        className="btn btn-primary full-width"
                        onClick={() => onStartChat(user)}
                    >
                        <Lock size={18} /> Start Secure Chat
                    </button>
                    <button 
                        className="btn btn-ghost full-width"
                        onClick={onClose}
                    >
                        Maybe Later
                    </button>
                </div>
            </div>
        </div>
    );
}
