import React, { useState, useEffect } from 'react';
import { formatAddress } from '../blockchain/web3Provider';
import './ProfilePreviewModal.css';

export function ProfilePreviewModal({ user, onClose, onStartChat, myAddress }) {
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
            <div className="profile-preview-card glass-card" onClick={e => e.stopPropagation()}>
                {/* Close button */}
                <button className="close-modal-btn" onClick={onClose}>×</button>
                
                {/* Avatar Section */}
                <div className="profile-preview-avatar-section">
                    <div className="profile-preview-avatar-ring">
                        {user.avatar ? (
                            <img src={user.avatar} alt="Avatar" className="profile-preview-avatar-img" />
                        ) : (
                            <div className="profile-preview-avatar-placeholder">
                                {(user.username || user.address || '??').slice(0, 2).toUpperCase()}
                            </div>
                        )}
                        {/* Online indicator */}
                        <span className={`profile-preview-status-dot ${isOnline ? 'online' : 'offline'}`}></span>
                    </div>
                </div>

                {/* User Info */}
                <div className="profile-preview-info">
                    <h2 className="profile-preview-name">{displayName}</h2>
                    {user.username && (
                        <p className="profile-preview-username">@{user.username}</p>
                    )}
                    


                    {/* Status tagline */}
                    {user.status && (
                        <p className="profile-preview-tagline">"{user.status}"</p>
                    )}
                </div>

                {/* Stats Row */}
                <div className="profile-preview-stats">
                    <div className="stat-item">
                        <span className="stat-icon">📅</span>
                        <div className="stat-text">
                            <span className="stat-label">Member Since</span>
                            <span className="stat-value">{formatDate(memberSince)}</span>
                        </div>
                    </div>
                    <div className="stat-divider"></div>
                    <div className="stat-item">
                        <span className="stat-icon">🛡️</span>
                        <div className="stat-text">
                            <span className="stat-label">Trust Score</span>
                            <span className="stat-value trust-score">
                                <span className="trust-badge">{user.trustScore || 0}</span>
                            </span>
                        </div>
                    </div>
                    <div className="stat-divider"></div>
                    <div className="stat-item">
                        <span className="stat-icon">{isOnline ? '🟢' : '🔴'}</span>
                        <div className="stat-text">
                            <span className="stat-label">Status</span>
                            <span className="stat-value">{isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="profile-preview-actions">
                    <button 
                        className="btn btn-primary btn-start-chat"
                        onClick={() => onStartChat(user)}
                    >
                        🔐 Start Secure Chat
                    </button>
                    <button 
                        className="btn btn-ghost btn-close-preview"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
