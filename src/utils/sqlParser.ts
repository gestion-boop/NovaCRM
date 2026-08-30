import { Contact, Deal, Task, NoteItem, ChatMessage } from '../types';

export interface ParsedSqlData {
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  notes: NoteItem[];
  messages: ChatMessage[];
  agenciesCount: number;
  pipelinesCount: number;
  stagesCount: number;
}

/**
 * Robust SQL Value Parser for PostgreSQL INSERT statements
 */
export function parseSqlValues(valuesString: string): Array<(string | number | boolean | null)> {
  const result: Array<string | number | boolean | null> = [];
  let current = '';
  let inString = false;
  let i = 0;

  while (i < valuesString.length) {
    const char = valuesString[i];

    if (inString) {
      if (char === "'" && valuesString[i + 1] === "'") {
        current += "'";
        i += 2;
        continue;
      } else if (char === "'") {
        inString = false;
        i++;
        continue;
      } else if (char === '\\' && valuesString[i + 1] === 'n') {
        current += '\n';
        i += 2;
        continue;
      } else {
        current += char;
        i++;
        continue;
      }
    } else {
      if (char === "'") {
        inString = true;
        i++;
        continue;
      } else if (char === ',' || char === ')') {
        const trimmed = current.trim();
        if (trimmed === 'NULL' || trimmed === 'null' || trimmed === '' || trimmed === '\\N') {
          result.push(null);
        } else if (trimmed === 'true' || trimmed === 't') {
          result.push(true);
        } else if (trimmed === 'false' || trimmed === 'f') {
          result.push(false);
        } else if (!isNaN(Number(trimmed)) && trimmed !== '') {
          result.push(Number(trimmed));
        } else {
          result.push(trimmed);
        }
        current = '';
        i++;
        continue;
      } else if (char === '(') {
        current = '';
        i++;
        continue;
      } else {
        current += char;
        i++;
        continue;
      }
    }
  }

  return result;
}

function resolveAgencyId(rowAgencyId?: unknown, overrideAgencyId?: string): string {
  if (overrideAgencyId && overrideAgencyId !== 'auto') {
    return overrideAgencyId;
  }
  const knownAgencyIds = [
    '30f96ea9-41da-41c2-a95e-f5e7898f8d8e', // Conseils Finances
    '0cd9362c-316e-4b57-af0b-b6cea092961b', // Novavisio
    '15157da9-71ea-4760-ae1c-3bc99d9caa20', // Immosphera
  ];
  if (rowAgencyId && knownAgencyIds.includes(String(rowAgencyId))) {
    return String(rowAgencyId);
  }
  // Default to Conseils Finances if unknown or missing
  return '30f96ea9-41da-41c2-a95e-f5e7898f8d8e';
}

function processRowIntoEntities(
  tableName: string,
  rawRow: Record<string, unknown>,
  columns: string[],
  contacts: Contact[],
  deals: Deal[],
  tasks: Task[],
  notes: NoteItem[],
  messages: ChatMessage[],
  overrideAgencyId?: string
) {
  const row = rawRow as Record<string, any>;
  const cleanTable = tableName.toLowerCase().replace(/["'`]/g, '');
  const assignedAgencyId = resolveAgencyId(row.agency_id, overrideAgencyId);

  const temperatureMap: Record<string, Contact['status']> = {
    chaud: 'Chaud',
    tiede: 'Tiède',
    froid: 'Froid',
  };

  if (['leads', 'contacts', 'clients', 'prospects', 'profiles', 'customers'].includes(cleanTable)) {
    const fullName = row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name || 'Client Importé';
    const status: Contact['status'] = row.temperature && temperatureMap[String(row.temperature).toLowerCase()]
      ? temperatureMap[String(row.temperature).toLowerCase()]
      : (row.status || 'Nouveau');

    const contact: Contact = {
      id: row.id || `lead-${Math.random().toString(36).substring(2, 9)}`,
      name: fullName,
      email: row.email || '',
      phone: row.phone || '',
      agencyId: assignedAgencyId,
      status,
      createdAt: row.created_at || new Date().toISOString(),
      budgetMax: row.budget ? Number(row.budget) : undefined,
      projectType: row.property_type || row.lead_type || undefined,
      comments: row.comments || row.notes || undefined,
      secteur: row.sector || undefined,
      typeBien: row.property_type || undefined,
      contactType: row.contact_type || undefined,
    };

    contacts.push(contact);

    if (row.estimated_value && Number(row.estimated_value) > 0) {
      deals.push({
        id: `deal-${row.id || Math.random().toString(36).substring(2, 9)}`,
        title: `Projet - ${fullName}`,
        amount: Number(row.estimated_value),
        stage: status === 'Chaud' ? 'Proposition' : 'Montage bancaire',
        agencyId: assignedAgencyId,
        contactId: contact.id,
        createdAt: row.created_at || new Date().toISOString(),
      });
    }
  } else if (['deals', 'opportunities', 'projects', 'projets', 'pipelines', 'pipeline_stages'].includes(cleanTable)) {
    if (cleanTable === 'deals' || cleanTable === 'opportunities' || cleanTable === 'projects' || cleanTable === 'projets') {
      deals.push({
        id: row.id || `deal-${Math.random().toString(36).substring(2, 9)}`,
        title: row.title || row.name || 'Projet CRM',
        amount: row.amount ? Number(row.amount) : (row.value ? Number(row.value) : 100000),
        stage: row.stage || 'Qualification',
        agencyId: assignedAgencyId,
        contactId: row.contact_id || row.lead_id || '',
        createdAt: row.created_at || new Date().toISOString(),
      });
    }
  } else if (['tasks', 'reminders', 'todos', 'action_items', 'taques'].includes(cleanTable)) {
    tasks.push({
      id: row.id || `task-${Math.random().toString(36).substring(2, 9)}`,
      title: row.title || row.content || row.description || 'Tâche Importée',
      completed: row.completed === true || row.status === 'completed' || row.status === 'done' || row.status === 't',
      dueDate: row.due_date || row.deadline || new Date().toISOString().split('T')[0],
      agencyId: assignedAgencyId,
      createdAt: row.created_at || new Date().toISOString(),
      priority: row.priority || 'Moyenne',
      type: row.type || 'Tâche',
      contactId: row.contact_id || row.lead_id || undefined,
    });
  } else if (['notes', 'lead_notes', 'comments', 'remarks'].includes(cleanTable)) {
    notes.push({
      id: row.id || `note-${Math.random().toString(36).substring(2, 9)}`,
      title: row.title || 'Note Importée',
      content: row.content || row.note || row.comment || row.description || '',
      category: row.category || 'Client',
      updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
      agencyId: assignedAgencyId,
    });
  } else if (['messages', 'chat_messages', 'announcements', 'posts', 'communications'].includes(cleanTable)) {
    messages.push({
      id: row.id || `msg-${Math.random().toString(36).substring(2, 9)}`,
      sender: row.sender || row.author || row.user_name || 'Collaborateur',
      message: row.message || row.content || row.body || row.text || '',
      timestamp: row.timestamp || row.created_at || new Date().toISOString(),
      isMe: false,
      channel: row.channel || 'Général',
      agencyId: assignedAgencyId,
    });
  }
}

export function parseSqlInsertDump(sqlText: string, overrideAgencyId?: string): ParsedSqlData {
  const contacts: Contact[] = [];
  const deals: Deal[] = [];
  const tasks: Task[] = [];
  const notes: NoteItem[] = [];
  const messages: ChatMessage[] = [];
  let agenciesCount = 0;
  let pipelinesCount = 0;
  let stagesCount = 0;

  if (!sqlText || !sqlText.trim()) {
    return { contacts, deals, tasks, notes, messages, agenciesCount, pipelinesCount, stagesCount };
  }

  // 1. Handle COPY FROM stdin blocks (pg_dump standard format)
  const copyRegex = /COPY\s+(?:(?:"?public"?|\b[a-zA-Z0-9_]+\b)\.)?("?[a-zA-Z0-9_]+"|\b[a-zA-Z0-9_]+\b)\s*\(([^)]+)\)\s+FROM\s+stdin/gi;
  let copyMatch;
  while ((copyMatch = copyRegex.exec(sqlText)) !== null) {
    const rawTableName = copyMatch[1].replace(/["'`]/g, '');
    const columns = copyMatch[2].split(',').map(c => c.trim().replace(/["'`]/g, '').toLowerCase());

    const startIndex = copyMatch.index + copyMatch[0].length;
    const endBlockIndex = sqlText.indexOf('\n\\.\n', startIndex);
    const blockText = endBlockIndex !== -1
      ? sqlText.substring(startIndex, endBlockIndex)
      : sqlText.substring(startIndex, startIndex + 500000);

    const lines = blockText.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine === '\\.') continue;
      if (trimmedLine.startsWith('COPY ') || trimmedLine.startsWith('SET ')) break;

      const values = line.split('\t').map(v => {
        if (v === '\\N' || v === 'NULL') return null;
        return v.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      });

      const row: Record<string, unknown> = {};
      columns.forEach((col, idx) => {
        row[col] = values[idx] !== undefined ? values[idx] : null;
      });

      processRowIntoEntities(rawTableName, row, columns, contacts, deals, tasks, notes, messages, overrideAgencyId);
    }
  }

  // 2. Handle INSERT INTO statements
  // Strip comment lines starting with --
  const cleanedSql = sqlText.replace(/--.*$/gm, '');

  // Match INSERT INTO statements with optional quotes and schema prefixes
  const insertRegex = /INSERT\s+INTO\s+(?:(?:"?[a-zA-Z0-9_]+"?|\b[a-zA-Z0-9_]+\b)\.)?("?[a-zA-Z0-9_]+"|\b[a-zA-Z0-9_]+\b)\s*\(([^)]+)\)\s*VALUES/gi;

  let match;
  while ((match = insertRegex.exec(cleanedSql)) !== null) {
    const rawTableName = match[1].replace(/["'`]/g, '');
    const columns = match[2].split(',').map(c => c.trim().replace(/["'`]/g, '').toLowerCase());
    const valuesStartIndex = match.index + match[0].length;

    // Extract all (...) tuples starting after VALUES
    const tupleMatches: string[] = [];
    let parenDepth = 0;
    let tupleStart = -1;
    let inQuotes = false;
    let i = valuesStartIndex;

    while (i < cleanedSql.length) {
      const char = cleanedSql[i];
      if (inQuotes) {
        if (char === "'" && cleanedSql[i + 1] === "'") {
          i += 2;
          continue;
        } else if (char === "'") {
          inQuotes = false;
        }
      } else {
        if (char === "'") {
          inQuotes = true;
        } else if (char === '(') {
          if (parenDepth === 0) tupleStart = i;
          parenDepth++;
        } else if (char === ')') {
          parenDepth--;
          if (parenDepth === 0 && tupleStart !== -1) {
            tupleMatches.push(cleanedSql.substring(tupleStart, i + 1));
            tupleStart = -1;
          }
        } else if (char === ';' && parenDepth === 0) {
          break;
        }
      }
      i++;
    }

    if (rawTableName.toLowerCase() === 'agencies') agenciesCount += tupleMatches.length;
    if (rawTableName.toLowerCase() === 'pipelines') pipelinesCount += tupleMatches.length;
    if (rawTableName.toLowerCase() === 'pipeline_stages') stagesCount += tupleMatches.length;

    for (const tuple of tupleMatches) {
      const parsedVals = parseSqlValues(tuple);
      const row: Record<string, unknown> = {};
      columns.forEach((col, idx) => {
        row[col] = parsedVals[idx];
      });

      processRowIntoEntities(rawTableName, row, columns, contacts, deals, tasks, notes, messages, overrideAgencyId);
    }
  }

  // 3. Fallback: line-by-line fallback if no standard structure was caught
  if (contacts.length === 0 && deals.length === 0 && tasks.length === 0 && notes.length === 0 && messages.length === 0) {
    // Attempt line scanning for email addresses or JSON objects
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const lines = sqlText.split('\n');
    for (const line of lines) {
      const emails = line.match(emailRegex);
      if (emails && emails.length > 0) {
        for (const email of emails) {
          if (email.includes('example.com') || email.includes('postgres')) continue;
          contacts.push({
            id: `fallback-${Math.random().toString(36).substring(2, 9)}`,
            name: email.split('@')[0].replace(/[._]/g, ' '),
            email,
            phone: '',
            agencyId: overrideAgencyId && overrideAgencyId !== 'auto' ? overrideAgencyId : '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
            status: 'Nouveau',
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  return {
    contacts,
    deals,
    tasks,
    notes,
    messages,
    agenciesCount,
    pipelinesCount,
    stagesCount,
  };
}
