import { useState, useEffect } from 'react';
import { getFingerprint } from '../crypto/crypto';
import './SafetyNumbers.css';

/**
 * SafetyNumbers Modal - Verifies cryptographic integrity of a contact
 * @param {Object} props
 * @param {Object} props.contact - The peer being verified
 * @param {Object} props.myKeys - Current user's keys
 * @param {boolean} props.isVerified - Current verification status
 * @param {Function} props.onVerify - Callback to toggle verification status
 * @param {Function} props.onClose - Callback to close the modal
 */
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

    const FingerprintBlocks = ({ fingerprint }) => {
        const blocks = fingerprint.split('-');
        return (
            <div className="fingerprint-grid">
                {blocks.map((block, i) => (
                    <div key={i} className="fingerprint-block">{block}</div>
                ))}
            </div>
        );
    };

    return (
        <div className="safety-modal-overlay" onClick={onClose}>
            <div className="safety-card" onClick={e => e.stopPropagation()}>
                <div className="safety-header">
                    <h2 className="safety-title">🛡️ Verify Safety Numbers</h2>
                    <button className="close-safety-btn" onClick={onClose}>×</button>
                </div>

                <p className="safety-description">
                    To verify the security of your end-to-end encryption with <b>{contact.username || contact.address.slice(0, 10)}</b>, 
                    compare the numbers below with the numbers on their screen.
                    <br/><br/>
                    If the numbers match, your conversation is guaranteed to be private and cannot be intercepted by any third party.
                </p>

                <div className="fingerprint-section">
                    <div className="user-identity">
                        {contact.avatar && <img src={contact.avatar} className="user-avatar-small" alt="" />}
                        <div>
                            <div className="user-label">{contact.username || 'Peer'}</div>
                            {isVerified && <div className="verified-badge-large">✅ Verified</div>}
                        </div>
                    </div>
                    <FingerprintBlocks fingerprint={peerFingerprint} />
                </div>

                <div className="fingerprint-section">
                    <div className="user-identity">
                        <div className="user-label">You (My Identity)</div>
                    </div>
                    <FingerprintBlocks fingerprint={myFingerprint} />
                </div>

                <div className="safety-verification-section">
                    <div className="verify-toggle-row">
                        <div className="verify-label">
                            <span>Mark as Verified</span>
                        </div>
                        <input 
                            type="checkbox" 
                            className="verify-checkbox" 
                            checked={isVerified} 
                            onChange={(e) => onVerify(e.target.checked)}
                        />
                    </div>
                    
                    <div className="safety-actions">
                        <button className="safety-primary-btn" onClick={onClose}>Done</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
