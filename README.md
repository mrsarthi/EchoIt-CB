# DecentraChat 

**A simple, secure, and private messaging app where you actually own your conversations.**

---

## What is DecentraChat?
Imagine a chat app like WhatsApp or Telegram, but without a big tech company sitting in the middle reading your messages or owning your account. 

With DecentraChat:
- **No phone numbers or emails needed.** You get a unique "Wallet Address" (a string of letters and numbers) that acts as your identity.
- **True Privacy.** Every message is locked (End-to-End Encrypted) before it leaves your device. Only the person you're talking to can unlock and read it.
- **No Central Server.** Your messages travel directly from your computer to your friend's computer. They aren't stored on some company's cloud server forever. *(We only use a temporary relay if a direct connection isn't possible, but even then, the relay can't read your locked messages!)*

## How does it work?
1. **Create an Account:** Make sure you have an account on Metamask (it is essential to make an acc with DecentraChat as well). After downloading the apk, open it and sign in through your metamask app. It will ask you for you digital signature, basically asking you if you trust DecentraChat or not (you can trust us). After which it will ask you to enter a username of your choice (REMEMBER, THE USERNAMES ARE IMMUTABLE   )
2. **Share your Address:** After the sign up process is done, you'll get an address (your ethereum wallet address), which can be copied after going on the top right of the app home page and copying it from the bottom. Send your unique address to your friends, they can search you up and voila, you can chat with each other now.
3. **Start Chatting:** Start a conversation! Messages are sent directly between you and your friends using secure peer-to-peer technology, which means, no one can intercept/hack it and even if they do, they can't see the message because only your friend with his private key can access it.
4. **Group Chats:** Create secure groups, invite your friends, and chat together, all completely encrypted.
5. **Media Sharing:** You can share images with your friends (more media support coming soon), all completely encrypted as well.

## Future Roadmap
- **Embedded Federated MQTT Broker**: Allow desktop users to host their own routing nodes using Aedes, completely eliminating reliance on centralized relays for users who prefer to route their own traffic.
