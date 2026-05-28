import React from 'react';
import { MessageSquare, Users, Settings } from 'lucide-react';
import './BottomNavBar.css';

export function BottomNavBar({ activeTab, onTabChange, hidden }) {
    if (hidden) return null;

    const tabs = [
        { id: 'chats', label: 'Chats', icon: MessageSquare },
        { id: 'contacts', label: 'Contacts', icon: Users },
        { id: 'settings', label: 'Settings', icon: Settings }
    ];

    return (
        <nav className="bottom-nav-bar animate-fadeIn">
            {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                    <button
                        key={tab.id}
                        className={`nav-tab-item ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => onTabChange(tab.id)}
                        aria-label={`Go to ${tab.label}`}
                    >
                        <div className="nav-tab-pill">
                            <Icon size={20} className="nav-tab-icon" />
                        </div>
                        <span className="nav-tab-label">{tab.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}

