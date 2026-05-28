import React, { useState, useRef } from 'react';
import { formatAddress } from '../blockchain/web3Provider';
import './CreateGroupModal.css'; // Re-use styles

export function GroupDetailsModal({ group, onClose, myAddress, onDeleteGroup, onRemoveMember, onUpdateGroupAvatar, contacts, onMessageMember }) {
    const fileInputRef = useRef(null);
    const [avatarPreview, setAvatarPreview] = useState(group?.avatar || null);

    if (!group) return null;

    const members = group.members || [];
    // Fallback for groups created before admin feature: treat first member as admin
    const admins = (group.admins && group.admins.length > 0) ? group.admins : (members.length > 0 ? [members[0]] : []);
    const isAdmin = admins.some(a => a.toLowerCase() === myAddress?.toLowerCase());

    const handleDeleteGroup = () => {
        if (!window.confirm(`Delete "${group.username || 'this group'}"?\n\nThis will remove the group and all its messages from your device. Other members will still have their copy.`)) return;
        onDeleteGroup?.(group.address);
        onClose();
    };

    const handleRemoveMember = (memberAddr) => {
        const displayName = formatAddress(memberAddr);
        if (!window.confirm(`Remove ${displayName} from the group?`)) return;
        onRemoveMember?.(group.address, memberAddr);
    };

    const handleAvatarChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_SIZE = 200;
                if (width > height) {
                    if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
                } else {
                    if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const compressed = canvas.toDataURL('image/jpeg', 0.6);
                setAvatarPreview(compressed);
                onUpdateGroupAvatar?.(group.address, compressed);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    const handleRemoveAvatar = () => {
        setAvatarPreview(null);
        onUpdateGroupAvatar?.(group.address, null);
    };

    // Check which members are NOT already in the user's contact list
    const contactAddresses = new Set((contacts || []).map(c => c.address.toLowerCase()));

    const handleMessageMember = (memberAddr) => {
        onMessageMember?.(memberAddr);
        onClose();
    };

    return (
        <div className="modal-overlay animate-fadeIn" onClick={onClose}>
            <div className="modal-content glass-card" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>👥 Group Details</h3>
                    <button className="close-modal-btn" onClick={onClose}>×</button>
                </div>

                <div className="modal-body">
                    {/* Group Avatar Section */}
                    <div className="group-avatar-section">
                        <div
                            className={`group-avatar-preview ${isAdmin ? 'editable' : ''}`}
                            onClick={() => isAdmin && fileInputRef.current?.click()}
                            title={isAdmin ? 'Click to change group photo' : ''}
                        >
                            {avatarPreview ? (
                                <img src={avatarPreview} alt="Group Avatar" className="group-avatar-img" />
                            ) : (
                                <div className="group-avatar-placeholder">👥</div>
                            )}
                            {isAdmin && (
                                <div className="group-avatar-overlay">
                                    <span>📷</span>
                                </div>
                            )}
                        </div>
                        {isAdmin && (
                            <input
                                type="file"
                                accept="image/*"
                                ref={fileInputRef}
                                onChange={handleAvatarChange}
                                style={{ display: 'none' }}
                            />
                        )}
                        {isAdmin && avatarPreview && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={handleRemoveAvatar}
                                style={{ fontSize: '0.75rem', marginTop: '6px' }}
                            >
                                Remove Photo
                            </button>
                        )}
                    </div>

                    <div className="group-info-section">
                        <h4>{group.username || 'Unnamed Group'}</h4>
                        <p className="text-muted text-sm">{members.length} members</p>
                    </div>

                    <div className="members-list-container">
                        <h5>Members</h5>
                        <div className="members-list">
                            {members.map(memberAddr => {
                                const isSelf = memberAddr.toLowerCase() === myAddress?.toLowerCase();
                                const isMemberAdmin = admins.some(a => a.toLowerCase() === memberAddr.toLowerCase());
                                const isInContacts = contactAddresses.has(memberAddr.toLowerCase());
                                const showMessageBtn = !isSelf && !isInContacts;
                                return (
                                    <div key={memberAddr} className="member-item">
                                        <div className="avatar small">
                                            {memberAddr.slice(2, 4).toUpperCase()}
                                        </div>
                                        <div className="member-info">
                                            <span className="member-name">
                                                {isSelf ? 'You' : formatAddress(memberAddr)}
                                            </span>
                                            <span className="member-address text-xs text-muted">
                                                {memberAddr}
                                            </span>
                                        </div>
                                        <div className="member-actions">
                                            {isMemberAdmin && (
                                                <span className="admin-badge">Admin</span>
                                            )}
                                            {showMessageBtn && (
                                                <button
                                                    className="btn-message-member"
                                                    onClick={() => handleMessageMember(memberAddr)}
                                                    title="Send message"
                                                >
                                                    💬
                                                </button>
                                            )}
                                            {isAdmin && !isSelf && !isMemberAdmin && (
                                                <button
                                                    className="btn-remove-member"
                                                    onClick={() => handleRemoveMember(memberAddr)}
                                                    title="Remove member"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="modal-footer" style={{ flexDirection: 'column', gap: '8px' }}>
                    {isAdmin && (
                        <button className="btn btn-danger full-width" onClick={handleDeleteGroup}>
                            🗑️ Delete Group
                        </button>
                    )}
                    <button className="btn btn-secondary full-width" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
