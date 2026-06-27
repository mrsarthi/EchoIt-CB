self.onmessage = async (e) => {
  const { password, saltHex, keylen } = e.data;
  try {
    const encoder = new TextEncoder();
    const passwordKey = await self.crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    // Convert salt hex to Uint8Array
    const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    
    const derivedBits = await self.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 600000,
        hash: 'SHA-256'
      },
      passwordKey,
      keylen * 8
    );
    
    const derivedHex = Array.from(new Uint8Array(derivedBits))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
      
    self.postMessage({ success: true, keyHex: derivedHex });
  } catch (err) {
    self.postMessage({ success: false, error: err.message });
  }
};
