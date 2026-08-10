export enum UserRole {
  BRIDE = 'bride',
  GROOM = 'groom',
  FAMILY = 'family',
  VENDOR = 'vendor',
  ADMIN = 'admin',
}

export enum ProfileVisibility {
  PUBLIC = 'public',
  MATCHES_ONLY = 'matches_only',
  PRIVATE = 'private',
}

export enum InterestStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

export enum VendorCategory {
  VENUE = 'venue',
  CATERING = 'catering',
  PHOTOGRAPHY = 'photography',
  DECOR = 'decor',
  MAKEUP = 'makeup',
  ENTERTAINMENT = 'entertainment',
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
}

export enum NotificationType {
  MATCH_INTEREST = 'match_interest',
  MATCH_ACCEPTED = 'match_accepted',
  NEW_MESSAGE = 'new_message',
  TASK_REMINDER = 'task_reminder',
  BOOKING_UPDATE = 'booking_update',
}

export enum BookingStatus {
  REQUESTED = 'requested',
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum PaymentStatus {
  INITIATED = 'initiated',
  HELD_IN_ESCROW = 'held_in_escrow',
  RELEASED = 'released',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

export enum RsvpStatus {
  INVITED = 'invited',
  ATTENDING = 'attending',
  DECLINED = 'declined',
  MAYBE = 'maybe',
}

export enum DisputeStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
  REJECTED = 'rejected',
}

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
}
