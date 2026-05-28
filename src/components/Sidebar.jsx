import React, { useState } from 'react';
import { Search, Shield, Plus, User, Users as UsersIcon, Settings } from 'lucide-react';
import { formatAddress } from '../blockchain/web3Provider';
import { TrustBadge } from './TrustBadge';
import './Sidebar.css';

export function Sidebar({ 
    myAvatar, 
    searchQuery,
    setSearchQuery,
    handleSearch,
    setShowProfileModal,
    setShowGroupModal,
    setShowSelfTrustDetails,
    contacts,
    activeChat,
    openChat,
    activeTab,
    setActiveTab
}) {
    const [showFabMenu, setShowFabMenu] = useState(false);

    const getFallbackColor = (address) => {
        if (!address) return '#3b82f6';
        const colors = ['#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6'];
        const index = parseInt(address.slice(2, 10), 16) % colors.length;
        return colors[index];
    };

    const onlineContacts = contacts.filter(c => c.online && !c.isGroup);

    return (
        <aside className="sidebar animate-fadeIn">
            {/* Header Area */}
            <div className="sidebar-header">
                <div className="sidebar-header-top">
                    <h2>{activeTab === 'contacts' ? 'Contacts' : 'Messages'}</h2>
                    <div className="header-actions">
                        <button 
                            className="trust-shield-btn btn-ghost" 
                            onClick={() => setShowSelfTrustDetails(true)} 
                            title="Trust Status"
                        >
                            <Shield size={20} />
                        </button>
                        
                        <button 
                            className="settings-btn-desktop btn-ghost" 
                            onClick={() => setActiveTab('settings')}
                            title="Settings"
                        >
                            <Settings size={20} />
                        </button>

                        <div className="user-profile-badge" onClick={() => setShowProfileModal(true)}>
                            <div className="avatar avatar-sm" style={{ overflow: 'hidden', background: myAvatar ? 'none' : 'var(--bg-elevated)' }}>
                                {myAvatar ? (
                                    <img src={myAvatar} alt="Me" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : <User size={16} />}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="sidebar-search-container">
                    <Search size={18} className="search-icon" />
                    <form onSubmit={handleSearch} style={{ flex: 1 }}>
                        <input
                            type="text"
                            className="sidebar-search-input"
                            placeholder={activeTab === 'contacts' ? "Find contacts..." : "Search messages..."}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </form>
                </div>
            </div>

            {activeTab === 'chats' && onlineContacts.length > 0 && (
                <div className="quick-status-bar">
                    {onlineContacts.map(contact => (
                        <div key={contact.address} className="quick-status-item" onClick={() => openChat(contact.address)}>
                            <div className={`status-avatar-wrapper ${contact.online ? 'online' : ''}`}>
                                <div className="avatar avatar-sm" style={{ background: contact.avatar ? 'none' : getFallbackColor(contact.address), overflow: 'hidden' }}>
                                    {contact.avatar ? (
                                        <img src={contact.avatar} alt="A" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : contact.username?.replace('@', '')[0]?.toUpperCase() || contact.address.slice(2, 4).toUpperCase()}
                                </div>
                            </div>
                            <span className="quick-status-name">
                                {contact.username?.replace('@', '') || formatAddress(contact.address)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <div className="contacts-list">
                {activeTab === 'chats' ? (
                    contacts.length === 0 ? (
                        <div className="empty-contacts">
                            <p className="text-muted">No messages yet</p>
                        </div>
                    ) : (
                        [...contacts]
                            .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0))
                            .map((contact) => (
                                <div
                                    key={contact.address}
                                    className={`sidebar-chat-item ${activeChat?.address === contact.address ? 'active' : ''}`}
                                    onClick={() => openChat(contact.address)}
                                >
                                    <div className="avatar" style={{ overflow: 'hidden', background: contact.avatar ? 'none' : getFallbackColor(contact.address) }}>
                                        {contact.isGroup ? (
                                            contact.avatar ? (
                                                <img src={contact.avatar} alt="G" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            ) : <UsersIcon size={20} />
                                        ) : (
                                            contact.avatar ? (
                                                <img src={contact.avatar} alt="A" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            ) : contact.username?.replace('@', '')[0]?.toUpperCase() || contact.address.slice(2, 4).toUpperCase()
                                        )}
                                    </div>
                                    <div className="chat-item-info">
                                        <span className="chat-item-name">
                                            {contact.username || (contact.isGroup ? 'Unnamed Group' : formatAddress(contact.address))}
                                            {!contact.isGroup && <TrustBadge stage={contact.trustStage || 1} compact />}
                                        </span>
                                        <span className="chat-item-preview">
                                            {contact.lastMessage || (contact.isGroup ? `${contact.members?.length || 0} members` : contact.status || 'No status')}
                                        </span>
                                    </div>
                                    <div className="chat-item-meta">
                                        {contact.unreadCount > 0 && (
                                            <span className="unread-badge">{contact.unreadCount}</span>
                                        )}
                                        {contact.online && !contact.isGroup && <span className="status-indicator online small"></span>}
                                    </div>
                                </div>
                            ))
                    )
                ) : (
                    contacts.filter(c => !c.isGroup).length === 0 ? (
                        <div className="empty-contacts">
                            <p className="text-muted">No contacts yet</p>
                        </div>
                    ) : (
                        [...contacts]
                            .filter(c => !c.isGroup)
                            .sort((a, b) => (a.username || '').localeCompare(b.username || ''))
                            .map((contact) => (
                                <div
                                    key={contact.address}
                                    className="sidebar-chat-item"
                                    onClick={() => openChat(contact.address)}
                                >
                                    <div className="avatar" style={{ overflow: 'hidden', background: contact.avatar ? 'none' : getFallbackColor(contact.address) }}>
                                        {contact.avatar ? (
                                            <img src={contact.avatar} alt="A" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : contact.username?.replace('@', '')[0]?.toUpperCase() || contact.address.slice(2, 4).toUpperCase()}
                                    </div>
                                    <div className="chat-item-info">
                                        <span className="chat-item-name">
                                            {contact.username || formatAddress(contact.address)}
                                            <TrustBadge stage={contact.trustStage || 1} compact />
                                        </span>
                                        <span className="chat-item-preview">{contact.status || 'Decentralized Peer'}</span>
                                    </div>
                                    {contact.online && <span className="status-indicator online small"></span>}
                                </div>
                            ))
                    )
                )}
            </div>
            
            {activeTab === 'contacts' && (
                <div className="sidebar-footer" style={{ position: 'relative' }}>
                    {showFabMenu && (
                        <div className="fab-menu animate-fadeIn">
                            <button className="fab-menu-item" onClick={() => { setShowGroupModal(true); setShowFabMenu(false); }}>
                                <UsersIcon size={18} /> Create Group
                            </button>
                            <button className="fab-menu-item" onClick={() => { 
                                document.querySelector('.sidebar-search-input')?.focus(); 
                                setShowFabMenu(false); 
                            }}>
                                <User size={18} /> Add Contact
                            </button>
                        </div>
                    )}
                    <button className={`fab-add-contact ${showFabMenu ? 'active' : ''}`} onClick={() => setShowFabMenu(!showFabMenu)} aria-label="Add Contact or Group">
                        <Plus size={24} style={{ transform: showFabMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }} />
                    </button>
                </div>
            )}
        </aside>
    );
}
