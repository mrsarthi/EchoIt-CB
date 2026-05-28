import React from 'react';
import { Shield, ShieldCheck } from 'lucide-react';
import './TrustBadge.css';

export function TrustBadge({ stage = 1, compact = false }) {
    const stages = {
        1: { label: 'New', icon: Shield, className: 'trust-stage-1' },
        2: { label: 'Verified', icon: ShieldCheck, className: 'trust-stage-2' },
        3: { label: 'Trusted', icon: ShieldCheck, className: 'trust-stage-3' }
    };

    const current = stages[stage] || stages[1];
    const Icon = current.icon;

    return (
        <span className={`trust-badge-v3 ${current.className} ${compact ? 'compact' : ''}`}
              title={`Trust Stage ${stage}: ${current.label}`}>
            <Icon size={compact ? 12 : 14} className="trust-badge-icon" />
            {!compact && <span className="trust-badge-label">{current.label}</span>}
        </span>
    );
}
