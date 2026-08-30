import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './src/lib/firebase';
import { Contact, Deal, Task } from './src/types';

const seedData = async () => {
  try {
    const contacts: Omit<Contact, 'id' | 'createdAt'>[] = [
      {
        name: 'Jean Dupont',
        email: 'jean.dupont@example.com',
        phone: '0612345678',
        agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
        status: 'Nouveau',
      },
      {
        name: 'Marie Martin',
        email: 'marie.martin@example.com',
        phone: '0687654321',
        agencyId: '0cd9362c-316e-4b57-af0b-b6cea092961b',
        status: 'Qualifié',
      }
    ];

    for (const contact of contacts) {
      await addDoc(collection(db, 'contacts'), { ...contact, createdAt: serverTimestamp() });
    }
    console.log('Contacts seeded!');
  } catch (e) {
    console.error('Error seeding data: ', e);
  }
};

seedData();
