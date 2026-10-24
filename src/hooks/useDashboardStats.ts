import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

export function useDashboardStats() {
  const { currentUser, activeAgency } = useAuth();
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);

  useEffect(() => {
    if (!currentUser) return;

    // Notifications: is_read = false AND user_id = currentUserId
    const notifsQuery = query(
      collection(db, 'notifications'),
      where('user_id', '==', currentUser.uid),
      where('is_read', '==', false)
    );

    const unsubscribeNotifs = onSnapshot(
      notifsQuery,
      (snapshot) => {
        setUnreadNotificationsCount(snapshot.size);
      },
      (error) => {
        console.warn("Firestore notifications query offline/unavailable:", error);
      }
    );

    // Unread Messages
    const messagesQuery = query(
      collection(db, 'message_receipts'),
      where('user_id', '==', currentUser.uid),
      where('read_at', '==', null)
    );
    
    const unsubscribeMessages = onSnapshot(
      messagesQuery,
      (snapshot) => {
        setUnreadMessagesCount(snapshot.size);
      },
      (error) => {
        console.warn("Firestore messages query offline/unavailable:", error);
      }
    );

    return () => {
      unsubscribeNotifs();
      unsubscribeMessages();
    };
  }, [currentUser, activeAgency]);

  return {
    unreadNotificationsCount,
    unreadMessagesCount
  };
}
