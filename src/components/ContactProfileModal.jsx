import React from 'react';
import { 
    ChevronDown, 
    MessageSquare, 
    ShieldCheck, 
    ExternalLink
} from 'lucide-react';
import { formatAddress } from '../blockchain/web3Provider';
import './ContactProfileModal.css';

export default function ContactProfileModal({ user, onClose, onStartChat, onVerify, isVerified, sharedMedia = [] }) {
    if (!user) return null;

    return (
        <div className="contact-profile-overlay" onClick={onClose}>
            <div className="contact-profile-drawer animate-slideUp" onClick={e => e.stopPropagation()}>
                {/* Hero Header */}
                <div className="profile-hero">
                    <button className="btn btn-ghost close-drawer-btn" onClick={onClose}>
                        <ChevronDown size={28} />
                    </button>
                    
                    <div className="hero-identity">
                        <div className="avatar avatar-xxl">
                            {user.avatar ? (
                                <img src={user.avatar} alt="Avatar" />
                            ) : user.address.slice(2, 4).toUpperCase()}
                            {user.online && <span className="online-badge-large"></span>}
                        </div>
                        <h2>{user.username || formatAddress(user.address)}</h2>
                        <p className="hero-address">{user.address}</p>
                    </div>

                    <div className="hero-actions">
                        <button className="hero-action-btn" onClick={() => { onStartChat(user); onClose(); }}>
                            <div className="action-icon-circle">
                                <MessageSquare size={22} />
                            </div>
                            <span>Message</span>
                        </button>
                        <button className="hero-action-btn" onClick={() => { onVerify(); onClose(); }}>
                            <div className="action-icon-circle">
                                <ShieldCheck size={22} className={isVerified ? 'text-trust' : ''} />
                            </div>
                            <span>{isVerified ? 'Verified' : 'Verify'}</span>
                        </button>
                    </div>
                </div>

                <div className="profile-scroll-content">
                    {/* Details Section */}
                    <div className="profile-info-section">
                        <div className="info-item">
                            <span className="info-label">Status</span>
                            <span className="info-value">{user.status || 'Decentralized Peer'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Blockchain Address</span>
                            <div className="flex items-center justify-between">
                                <span className="info-value text-sm">{formatAddress(user.address, 12)}</span>
                                <ExternalLink size={14} className="text-muted" />
                            </div>
                        </div>
                    </div>

                    {/* Shared Media */}
                    <div className="profile-media-section">
                        <div className="section-header">
                            <h3>Shared Media</h3>
                            <span className="text-muted text-xs font-semibold">{sharedMedia.length} ITEMS</span>
                        </div>
                        {sharedMedia.length > 0 ? (
                            <div className="media-grid">
                                {sharedMedia.slice(0, 3).map((item, i) => (
                                    <div key={i} className="media-thumb">
                                        <img src={item} alt="Shared" />
                                    </div>
                                ))}
                                {sharedMedia.length > 3 && (
                                    <div className="media-thumb overlay">
                                        <span>+{sharedMedia.length - 3}</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-muted text-sm italic">No media shared yet</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
