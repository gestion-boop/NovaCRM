export interface TaskDateStatus {
  status: 'overdue' | 'today' | 'upcoming' | 'future';
  color: 'red' | 'orange' | 'green';
  bgClass: string;
  badgeClass: string;
  textClass: string;
  borderClass: string;
  dotClass: string;
  label: string;
  diffDays: number;
}

export function getTaskDateStatus(dueDateStr?: string): TaskDateStatus {
  if (!dueDateStr) {
    return {
      status: 'future',
      color: 'green',
      bgClass: 'bg-emerald-500/15',
      badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      textClass: 'text-emerald-400',
      borderClass: 'border-emerald-500/40',
      dotClass: 'bg-emerald-500',
      label: 'À venir',
      diffDays: 999,
    };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let taskDateObj: Date;
  if (dueDateStr.includes('T')) {
    const [dPart] = dueDateStr.split('T');
    const [y, m, d] = dPart.split('-').map(Number);
    taskDateObj = new Date(y, m - 1, d);
  } else {
    const [y, m, d] = dueDateStr.split('-').map(Number);
    taskDateObj = new Date(y, m - 1, d);
  }

  if (isNaN(taskDateObj.getTime())) {
    return {
      status: 'future',
      color: 'green',
      bgClass: 'bg-emerald-500/15',
      badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      textClass: 'text-emerald-400',
      borderClass: 'border-emerald-500/40',
      dotClass: 'bg-emerald-500',
      label: 'À venir',
      diffDays: 999,
    };
  }

  // Calculate calendar day difference
  const diffTime = taskDateObj.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

  if (diffDays < 0) {
    // Overdue (J-) => ROUGE
    return {
      status: 'overdue',
      color: 'red',
      bgClass: 'bg-red-500/15',
      badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
      textClass: 'text-red-400',
      borderClass: 'border-red-500/40',
      dotClass: 'bg-red-500',
      label: `Retard (${Math.abs(diffDays)}j)`,
      diffDays,
    };
  } else if (diffDays === 0) {
    // Today (Jour J) => ROUGE
    return {
      status: 'today',
      color: 'red',
      bgClass: 'bg-red-500/15',
      badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
      textClass: 'text-red-400',
      borderClass: 'border-red-500/40',
      dotClass: 'bg-red-500',
      label: "Aujourd'hui (Jour J)",
      diffDays,
    };
  } else if (diffDays === 1) {
    // Tomorrow / J+1 / J-2 from target => ORANGE
    return {
      status: 'upcoming',
      color: 'orange',
      bgClass: 'bg-amber-500/15',
      badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      textClass: 'text-amber-400',
      borderClass: 'border-amber-500/40',
      dotClass: 'bg-amber-500',
      label: 'Demain (J+1)',
      diffDays,
    };
  } else {
    // diffDays >= 2 => VERT (J+2 et plus)
    return {
      status: 'future',
      color: 'green',
      bgClass: 'bg-emerald-500/15',
      badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      textClass: 'text-emerald-400',
      borderClass: 'border-emerald-500/40',
      dotClass: 'bg-emerald-500',
      label: `À J+${diffDays}`,
      diffDays,
    };
  }
}

/**
 * Counts only pending tasks that are due TODAY (Jour J) or OVERDUE (J-)
 */
export function countTodayAndOverdueTasks(tasks: { completed?: boolean; dueDate?: string }[] = []): number {
  return tasks.filter(t => {
    if (t.completed) return false;
    const status = getTaskDateStatus(t.dueDate);
    return status.diffDays <= 0; // Jour J et J- (retards)
  }).length;
}
