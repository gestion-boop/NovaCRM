import { supabase } from './src/lib/supabase';
import { Contact } from './src/types';

const seedSupabase = async () => {
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

    const { data, error } = await supabase.from('contacts').insert(contacts);
    if (error) throw error;
    console.log('Contacts seeded in Supabase!');
  } catch (e) {
    console.error('Error seeding Supabase: ', e);
  }
};

seedSupabase();
