import React from 'react';
import { Shield, X, Info } from 'lucide-react';
import { TrustBadge } from './TrustBadge';

export function SelfTrustDetailsModal({ trustStage, trustScore, onClose }) {
    return (
        <div className="modal-overlay animate-fadeIn" onClick={onClose}>
            <div className="modal-content animate-scaleIn" style={{ maxWidth: '320px', maxHeight: '90vh', overflowY: 'auto', padding: 'var(--space-lg)' }} onClick={e => e.stopPropagation()}>
                <div className="modal-header" style={{ border: 'none', padding: 0, marginBottom: 'var(--space-lg)' }}>
                    <h2 style={{ fontSize: '1.25rem' }}>Your Trust Status</h2>
                    <button className="btn btn-ghost" onClick={onClose}><X size={20} /></button>
                </div>
                
                <div className="flex flex-col items-center gap-md text-center">
                    <div className="avatar avatar-lg" style={{ background: 'var(--trust-soft)', color: 'var(--trust)' }}>
                        <Shield size={32} />
                    </div>
                    
                    <div>
                        <div style={{ marginBottom: 'var(--space-sm)' }}>
                            <TrustBadge stage={trustStage} />
                        </div>
                        <p className="text-secondary text-sm">
                            Network Trust Score: <strong className="text-primary">{trustScore}</strong>
                        </p>
                    </div>

                    <div className="settings-group" style={{ textAlign: 'left', width: '100%', marginTop: 'var(--space-md)' }}>
                        <div className="settings-item" style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)' }}>
                            <Info size={16} className="text-primary" style={{ flexShrink: 0 }} />
                            <p className="text-xs text-secondary" style={{ lineHeight: 1.4 }}>
                                Your trust stage increases as you interact with other verified peers in the network.
                            </p>
                        </div>
                    </div>

                    <button className="btn btn-primary full-width" onClick={onClose}>
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}
