import React from 'react';
import './BottomNavBar.css';

export function BottomNavBar({ activeTab, onTabChange, hidden }) {
    if (hidden) return null;

    const tabs = [
        { id: 'chats', label: 'Chats', icon: 'chat_bubble' },
        { id: 'contacts', label: 'Contacts', icon: 'group' },
        { id: 'settings', label: 'Settings', icon: 'settings' }
    ];

    return (
        <nav className="fixed bottom-0 left-0 w-full bg-surface-container border-t border-outline-variant/30 px-6 py-2 flex items-center justify-around z-40 lg:hidden">
            {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        className="flex-1 flex flex-col items-center justify-center gap-1 active:scale-95 duration-200 transition-transform cursor-pointer"
                        onClick={() => onTabChange(tab.id)}
                        aria-label={`Go to ${tab.label}`}
                    >
                        <div className={`w-16 h-8 rounded-full flex items-center justify-center transition-colors ${isActive ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-bright'}`}>
                            <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}>{tab.icon}</span>
                        </div>
                        <span className={`font-label-sm text-[12px] font-medium ${isActive ? 'text-on-surface' : 'text-on-surface-variant'}`}>{tab.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
