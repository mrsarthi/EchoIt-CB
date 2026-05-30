import React, { useState } from 'react';
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
        <aside className="w-full flex-shrink-0 lg:w-96 border-r border-outline-variant/30 flex flex-col h-full bg-background text-on-background selection:bg-primary-container selection:text-on-primary-container">
            {/* TopAppBar */}
            <header className="w-full flex-shrink-0 z-10 bg-surface h-16 flex items-center justify-between px-gutter chat-header-container">
                <div className="flex items-center gap-4">
                    <button 
                        className="active:scale-95 duration-200 hover:opacity-80 transition-opacity flex items-center justify-center" 
                        onClick={() => setShowSelfTrustDetails(true)} 
                        title="Trust Status"
                    >
                        <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}>shield</span>
                    </button>
                    <h1 className="font-headline-md text-headline-md font-semibold text-primary">
                        {activeTab === 'contacts' ? 'Contacts' : 'Messages'}
                    </h1>
                </div>
                <div className="flex items-center gap-stack-md">
                    <button 
                        className="hover:opacity-80 transition-opacity active:scale-95 duration-200 hidden lg:flex items-center justify-center"
                        onClick={() => setActiveTab('settings')}
                        title="Settings"
                    >
                        <span className="material-symbols-outlined text-on-surface-variant">settings</span>
                    </button>
                    <div 
                        className="w-10 h-10 rounded-full overflow-hidden border border-outline-variant cursor-pointer active:scale-95 duration-200 flex items-center justify-center bg-surface-container-highest"
                        onClick={() => setShowProfileModal(true)}
                    >
                        {myAvatar ? (
                            <img src={myAvatar} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                            <span className="material-symbols-outlined text-on-surface-variant">person</span>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto chat-scroll px-container-padding-mobile md:px-container-padding-desktop pb-32">
                {/* Search Bar */}
                <section className="mt-stack-md">
                    <form onSubmit={handleSearch} className="relative w-full">
                        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
                        <input 
                            className="w-full bg-surface-container border-none rounded-xl py-4 pl-12 pr-4 text-on-surface placeholder:text-outline focus:ring-2 focus:ring-secondary transition-all font-body-md" 
                            placeholder={activeTab === 'contacts' ? "Find contacts..." : "Search conversations"} 
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </form>
                </section>

                {/* Stories / Active Now (Bento Style) - Only on Chats Tab */}
                {activeTab === 'chats' && onlineContacts.length > 0 && (
                    <section className="mt-stack-lg">
                        <h2 className="font-label-md text-label-md text-on-surface-variant mb-stack-md">Recently Active</h2>
                        <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                            {onlineContacts.map(contact => (
                                <div key={contact.address} className="flex-shrink-0 flex flex-col items-center gap-2 group cursor-pointer" onClick={() => openChat(contact.address)}>
                                    <div className="w-16 h-16 rounded-full border-2 border-secondary p-1">
                                        <div className="w-full h-full rounded-full overflow-hidden bg-surface-container-highest flex items-center justify-center text-on-surface-variant font-bold text-lg" style={{ background: contact.avatar ? 'transparent' : getFallbackColor(contact.address) }}>
                                            {contact.avatar ? (
                                                <img src={contact.avatar} alt="A" className="w-full h-full object-cover" />
                                            ) : (
                                                contact.username?.replace('@', '')[0]?.toUpperCase() || contact.address.slice(2, 4).toUpperCase()
                                            )}
                                        </div>
                                    </div>
                                    <span className="block font-label-sm text-label-sm truncate max-w-[64px] text-center text-on-surface">
                                        {contact.username?.replace('@', '') || formatAddress(contact.address)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Message / Contacts List */}
                <section className="mt-stack-lg flex flex-col gap-stack-sm">
                    <h2 className="font-label-md text-label-md text-on-surface-variant mb-stack-sm">
                        {activeTab === 'chats' ? 'Recent Messages' : 'All Contacts'}
                    </h2>
                    
                    {activeTab === 'chats' ? (
                        contacts.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="font-body-md text-on-surface-variant">No messages yet</p>
                            </div>
                        ) : (
                            [...contacts]
                                .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0))
                                .map((contact) => (
                                    <div 
                                        key={contact.address} 
                                        className={`flex items-center gap-4 p-4 rounded-xl transition-colors cursor-pointer group active:scale-[0.98] duration-200 ${activeChat?.address === contact.address ? 'bg-surface-bright' : 'bg-surface-container hover:bg-surface-bright'}`}
                                        onClick={() => openChat(contact.address)}
                                    >
                                        <div className="relative flex-shrink-0">
                                            <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg overflow-hidden text-white" style={{ background: contact.avatar ? 'transparent' : getFallbackColor(contact.address) }}>
                                                {contact.isGroup ? (
                                                    contact.avatar ? (
                                                        <img src={contact.avatar} className="w-full h-full object-cover" alt="G" />
                                                    ) : (
                                                        <span className="material-symbols-outlined text-white">group</span>
                                                    )
                                                ) : (
                                                    contact.avatar ? (
                                                        <img src={contact.avatar} className="w-full h-full object-cover" alt="A" />
                                                    ) : (
                                                        contact.username?.replace('@', '')[0]?.toUpperCase() || contact.address.slice(2, 4).toUpperCase()
                                                    )
                                                )}
                                            </div>
                                            {contact.online && !contact.isGroup && (
                                                <div className="absolute bottom-0 right-0 w-4 h-4 bg-secondary border-4 border-surface-container rounded-full"></div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-baseline gap-2">
                                                <h3 className="font-label-md text-label-md text-on-surface font-semibold flex items-center gap-1 min-w-0">
                                                    <span className="truncate">{contact.username || (contact.isGroup ? 'Unnamed Group' : formatAddress(contact.address))}</span>
                                                    {!contact.isGroup && <TrustBadge stage={contact.trustStage || 1} compact />}
                                                </h3>
                                                {contact.lastMessageTime && (
                                                    <span className="font-label-sm text-label-sm text-on-surface-variant flex-shrink-0">
                                                        {new Date(contact.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="font-body-md text-body-md text-on-surface-variant truncate">
                                                {contact.lastMessage || (contact.isGroup ? `${contact.members?.length || 0} members` : contact.status || 'No status')}
                                            </p>
                                        </div>
                                        {contact.unreadCount > 0 && (
                                            <div className="bg-primary text-on-primary text-[10px] px-2 py-0.5 rounded-full font-bold">
                                                {contact.unreadCount}
                                            </div>
                                        )}
                                    </div>
                                ))
                        )
                    ) : (
                        contacts.filter(c => !c.isGroup).length === 0 ? (
                            <div className="text-center py-8">
                                <p className="font-body-md text-on-surface-variant">No contacts yet</p>
                            </div>
                        ) : (
                            [...contacts]
                                .filter(c => !c.isGroup)
                                .sort((a, b) => (a.username || '').localeCompare(b.username || ''))
                                .map((contact) => (
                                    <div 
                                        key={contact.address} 
                                        className="flex items-center gap-4 p-4 rounded-xl bg-surface-container hover:bg-surface-bright transition-colors cursor-pointer group active:scale-[0.98] duration-200"
                                        onClick={() => openChat(contact.address)}
                                    >
                                        <div className="relative flex-shrink-0">
                                            <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg overflow-hidden text-white" style={{ background: contact.avatar ? 'transparent' : getFallbackColor(contact.address) }}>
                                                {contact.avatar ? (
                                                    <img src={contact.avatar} className="w-full h-full object-cover" alt="A" />
                                                ) : (
                                                    contact.username?.replace('@', '')[0]?.toUpperCase() || contact.address.slice(2, 4).toUpperCase()
                                                )}
                                            </div>
                                            {contact.online && (
                                                <div className="absolute bottom-0 right-0 w-4 h-4 bg-secondary border-4 border-surface-container rounded-full"></div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                                            <h3 className="font-label-md text-label-md text-on-surface font-semibold flex items-center gap-1 min-w-0">
                                                <span className="truncate">{contact.username || formatAddress(contact.address)}</span>
                                                <TrustBadge stage={contact.trustStage || 1} compact />
                                            </h3>
                                            <p className="font-body-md text-body-md text-on-surface-variant truncate">
                                                {contact.status || 'Decentralized Peer'}
                                            </p>
                                        </div>
                                    </div>
                                ))
                        )
                    )}
                </section>
            </main>

            {/* FAB */}
            {activeTab === 'contacts' && (
                <>
                    {showFabMenu && (
                        <div className="fixed bottom-[110px] right-6 flex flex-col gap-3 z-40 animate-fadeIn">
                            <button 
                                className="flex items-center gap-3 bg-surface-container-high text-on-surface px-4 py-3 rounded-xl shadow-lg active:scale-95 transition-transform" 
                                onClick={() => { setShowGroupModal(true); setShowFabMenu(false); }}
                            >
                                <span className="font-label-md">Create Group</span>
                                <span className="material-symbols-outlined text-primary">group_add</span>
                            </button>
                            <button 
                                className="flex items-center gap-3 bg-surface-container-high text-on-surface px-4 py-3 rounded-xl shadow-lg active:scale-95 transition-transform" 
                                onClick={() => { document.querySelector('input[type="text"]')?.focus(); setShowFabMenu(false); }}
                            >
                                <span className="font-label-md">Add Contact</span>
                                <span className="material-symbols-outlined text-primary">person_add</span>
                            </button>
                        </div>
                    )}
                    <button 
                        className="fixed bottom-24 right-6 w-14 h-14 bg-primary text-on-primary rounded-xl shadow-lg flex items-center justify-center active:scale-90 transition-transform z-40"
                        onClick={() => setShowFabMenu(!showFabMenu)}
                        style={{ transform: showFabMenu ? 'rotate(45deg)' : 'none' }}
                    >
                        <span className="material-symbols-outlined">add</span>
                    </button>
                </>
            )}
        </aside>
    );
}
