import { Contact, Deal, Task, NoteItem, ChatMessage, ChatGroup, PipelineDef } from '../types';

export interface CrmImportedStorage {
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  notes: NoteItem[];
  messages: ChatMessage[];
  groups: ChatGroup[];
  pipelines?: PipelineDef[];
}

const STORAGE_KEY = 'crm_imported_data_v1';

export function getImportedStorage(): CrmImportedStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
        deals: Array.isArray(parsed.deals) ? parsed.deals : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        pipelines: Array.isArray(parsed.pipelines) ? parsed.pipelines : undefined,
      };
    }
  } catch (err) {
    console.error('Error reading imported storage:', err);
  }
  return { contacts: [], deals: [], tasks: [], notes: [], messages: [], groups: [] };
}

export function saveImportedStorage(newData: Partial<CrmImportedStorage>): CrmImportedStorage {
  const current = getImportedStorage();

  const updated: CrmImportedStorage = {
    contacts: newData.contacts !== undefined ? newData.contacts : current.contacts,
    deals: newData.deals !== undefined ? newData.deals : current.deals,
    tasks: newData.tasks !== undefined ? newData.tasks : current.tasks,
    notes: newData.notes !== undefined ? newData.notes : current.notes,
    messages: newData.messages !== undefined ? newData.messages : current.messages,
    groups: newData.groups !== undefined ? newData.groups : current.groups,
    pipelines: newData.pipelines !== undefined ? newData.pipelines : current.pipelines,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    // Dispatch custom event so listeners know data was updated
    window.dispatchEvent(new CustomEvent('crm_imported_data_changed'));
  } catch (err) {
    console.error('Error saving imported storage:', err);
  }

  return updated;
}

export function clearImportedStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('crm_imported_data_changed'));
  } catch (err) {
    console.error('Error clearing imported storage:', err);
  }
}
