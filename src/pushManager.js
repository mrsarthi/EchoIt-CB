// pushManager.js: Capacitor native FCM silent push notification manager

export const initPushNotifications = async (client) => {
  try {
    if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform()) {
      const { PushNotifications } = await import('@capacitor/push-notifications');

      // Request permissions
      let permStatus = await PushNotifications.checkPermissions();
      
      if (permStatus.receive === 'prompt') {
        permStatus = await PushNotifications.requestPermissions();
      }

      if (permStatus.receive !== 'granted') {
        console.warn("[Push] Push notification permission not granted.");
        return;
      }

      // Register with FCM/APNs
      await PushNotifications.register();

      // Listen for registration success to retrieve push token
      PushNotifications.addListener('registration', async (token) => {
        console.log("[Push] Registered token:", token.value);
        if (client && client.connected && client.socket) {
          try {
            // Register token on relay server
            await new Promise((resolve, reject) => {
              client.socket.emit('setPushToken', { pushToken: token.value }, (res) => {
                if (res.success) resolve();
                else reject(new Error(res.error));
              });
            });
            console.log("[Push] Token successfully uploaded to DecentraChat relay.");
          } catch (err) {
            console.error("[Push] Failed to upload push token:", err.message);
          }
        }
      });

      // Listen for registration error
      PushNotifications.addListener('registrationError', (error) => {
        console.error("[Push] Registration error:", error.error);
      });

      // Listen for silent push notification (background fetch wakeup)
      PushNotifications.addListener('pushNotificationReceived', async (notification) => {
        console.log("[Push] Silent push notification received:", notification);
        if (client) {
          console.log("[Push] Triggering background sync offline queue...");
          await client.syncOfflineMessages();
        }
      });
    } else {
      console.log("[Push] Non-native platform. Push notification listener skipped.");
    }
  } catch (err) {
    console.error("[Push] Push Notification initialization failed:", err.message);
  }
};
