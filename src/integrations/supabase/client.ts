// Shim de compatibilité : le module ImmoSphera 360 (importé depuis ConnectSphere
// CRM) attend un client à ce chemin. Le vrai projet Supabase de ConnectSphere
// EST le même que celui de cette application (rbzizzzvitxwnfygdpzo — vérifié :
// la table immosphera_properties et ses données réelles y existent déjà), donc
// on réexporte simplement le client Supabase déjà configuré de l'app.
export { supabase } from '@/lib/supabase';
