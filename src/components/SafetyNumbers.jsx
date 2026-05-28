import { useState, useEffect } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { getFingerprint } from '../crypto/crypto';
import { formatAddress } from '../blockchain/web3Provider';
import './SafetyNumbers.css';

const FingerprintGrid = ({ fingerprint }) => {
    const blocks = (fingerprint || '00000-00000-00000-00000-00000-00000-00000-00000').split('-');
    return (
        <div className="safety-grid">
            {blocks.map((block, i) => (
                <div key={i} className="safety-block">
                    <code>{block}</code>
                </div>
            ))}
        </div>
    );
};

export default function SafetyNumbers({ contact, myKeys, isVerified, onVerify, onClose }) {
    const [myFingerprint, setMyFingerprint] = useState('Loading...');
    const [peerFingerprint, setPeerFingerprint] = useState('Loading...');

    useEffect(() => {
        const loadFingerprints = async () => {
            if (myKeys?.publicKey) {
                const f = await getFingerprint(myKeys.publicKey);
                setMyFingerprint(f);
            }
            if (contact?.publicKey) {
                const f = await getFingerprint(contact.publicKey);
                setPeerFingerprint(f);
            }
        };
        loadFingerprints();
    }, [contact, myKeys]);

    const isMatch = myFingerprint !== 'Loading...' && peerFingerprint !== 'Loading...' && myFingerprint === peerFingerprint;

    return (
        <div className="safety-numbers-overlay" onClick={onClose}>
            <div className="safety-numbers-modal animate-scaleIn" onClick={e => e.stopPropagation()}>
                <div className="safety-numbers-header">
                    <button className="btn btn-ghost close-btn" onClick={onClose}>
                        <X size={24} />
                    </button>
                    
                    <div className="safety-header-identity">
                        <div className="avatar avatar-lg">
                            {contact?.avatar ? (
                                <img src={contact.avatar} alt="A" />
                            ) : contact?.address?.slice(2, 4).toUpperCase()}
                            {isVerified && <ShieldCheck size={16} className="verified-overlap" />}
                        </div>
                        <h3>{contact?.username || formatAddress(contact?.address)}</h3>
                        <p className="text-muted text-sm">Security Verification</p>
                    </div>
                </div>

                <div className="safety-numbers-content">
                    <div className="safety-alert">
                        <ShieldCheck size={20} className={isVerified ? 'text-trust' : 'text-primary'} />
                        <p className="safety-desc">
                            Compare these numbers with <strong>{contact?.username || 'the recipient'}</strong> to confirm end-to-end encryption.
                        </p>
                    </div>

                    <div className="fingerprint-section">
                        <label className="fingerprint-label">Your Fingerprint</label>
                        <FingerprintGrid fingerprint={myFingerprint} />
                    </div>

                    <div className="fingerprint-section">
                        <label className="fingerprint-label">Peer Fingerprint</label>
                        <FingerprintGrid fingerprint={peerFingerprint} />
                    </div>

                    {isMatch && (
                        <div className="safety-match-badge animate-fadeIn">
                            <ShieldCheck size={14} /> Identity Match Confirmed
                        </div>
                    )}

                    <div className="safety-actions">
                        <button 
                            className={`btn ${isVerified ? 'btn-secondary' : 'btn-primary'} full-width`}
                            onClick={() => onVerify(!isVerified)}
                        >
                            {isVerified ? 'Revoke Verification' : 'Verify Connection'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
