/**
 * Default wedding timeline template. Each entry generates a task with a due date
 * computed as (weddingDate - daysBefore). This is data, not logic, edit freely
 * or load from a config source without touching the planner algorithm.
 */
export interface TimelineTemplateItem {
  title: string;
  category: string;
  daysBefore: number;
}

export const DEFAULT_TIMELINE_TEMPLATE: TimelineTemplateItem[] = [
  { title: 'Set overall budget', category: 'Finance', daysBefore: 300 },
  { title: 'Draft guest list', category: 'Guests', daysBefore: 270 },
  { title: 'Book venue', category: 'Venue', daysBefore: 240 },
  { title: 'Book catering', category: 'Catering', daysBefore: 210 },
  { title: 'Book photographer', category: 'Photography', daysBefore: 180 },
  { title: 'Finalize decor & theme', category: 'Decor', daysBefore: 150 },
  { title: 'Send invitations', category: 'Guests', daysBefore: 90 },
  { title: 'Book makeup artist', category: 'Makeup', daysBefore: 75 },
  { title: 'Confirm RSVPs', category: 'Guests', daysBefore: 30 },
  { title: 'Finalize seating arrangement', category: 'Events', daysBefore: 14 },
  { title: 'Confirm vendor logistics', category: 'Logistics', daysBefore: 7 },
];
