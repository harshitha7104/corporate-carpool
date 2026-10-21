export type VerificationStatus = "not_submitted" | "pending_review" | "verified" | "rejected" | "needs_info" | "expired";

export interface VerificationItem {
  id?: string;
  status: VerificationStatus;
  documentType?: string;
  documentLast4?: string;
  reviewerNotes?: string | null;
  submittedAt?: string;
  reviewedAt?: string | null;
  expiresAt?: string | null;
}

export interface Me {
  id: string;
  phone: string | null;
  email: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  status: string;
  isDemo: boolean;
  createdAt: string;
  profileComplete: boolean;
  profile: { fullName: string; gender: string | null; bio: string | null; homeArea: string | null; workArea: string | null } | null;
  preferences: { notifyEmail: boolean; notifySms: boolean; notifyWhatsapp: boolean };
  driver: { licenseLast4: string | null; licenseExpiry: string | null; yearsDriving: number | null } | null;
  roles: string[];
  permissions: string[];
  verification: { government_id: VerificationItem; driving_license: VerificationItem };
  rating: { average: number | null; count: number };
}

export interface Place {
  label: string;
  lat: number;
  lng: number;
  address?: string;
}

export interface PublicProfile {
  id: string;
  displayName: string;
  initials: string;
  bio: string | null;
  memberSince: string;
  isDemo: boolean;
  idVerified: boolean;
  licenceVerified: boolean;
  rating: number | null;
  reviewCount: number;
  ridesDriven: number;
  ridesTaken: number;
}

export interface Match {
  score: number;
  parts: { overlap: number; detour: number; time: number; price: number };
  pickupDistanceM: number;
  dropoffDistanceM: number;
  sharedDistanceM: number;
  detourM: number;
  estimatedPickupAt: string;
  estimatedDropoffAt: string;
  isEstimate: boolean;
}

export interface Ride {
  id: string;
  status: "draft" | "published" | "in_progress" | "completed" | "cancelled";
  isDemo: boolean;
  origin: Place;
  destination: Place;
  stops: (Place & { id: string; seq: number; offsetMinutes: number })[];
  departureAt: string;
  estArrivalAt: string;
  distanceM: number;
  durationS: number;
  routeSource: string;
  routeIsEstimate: boolean;
  route: [number, number][];
  seatsTotal: number;
  seatsAvailable: number;
  pricePerSeatPaise: number;
  suggestedPricePaise: number;
  bookingMode: "instant" | "request";
  bookingCutoffMinutes: number;
  bookingClosesAt: string;
  womenOnly: boolean;
  luggage: string;
  notes: string | null;
  preferences: Record<string, unknown>;
  recurringRuleId: string | null;
  locationSharing: boolean;
  vehicle: { make: string; model: string; color: string; plateNumber: string; fuelType: string | null; verified: boolean };
  driver: PublicProfile;
  isDriver: boolean;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  myBooking?: { id: string; status: BookingStatus } | null;
  match?: Match;
  pendingRequests?: number;
}

export type BookingStatus =
  | "REQUESTED" | "ACCEPTED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED"
  | "REJECTED" | "CANCELLED_BY_PASSENGER" | "CANCELLED_BY_DRIVER" | "EXPIRED" | "NO_SHOW" | "DISPUTED";

export interface Booking {
  id: string;
  status: BookingStatus;
  seats: number;
  isDemo: boolean;
  pickup: Place;
  dropoff: Place;
  pickupEtaAt: string | null;
  detourM: number | null;
  contributionPaise: number;
  platformFeePaise: number;
  totalPaise: number;
  message: string | null;
  expiresAt: string | null;
  requestedAt: string;
  acceptedAt: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  events: { from_status: string | null; to_status: string; actor_role: string; reason: string | null; created_at: string }[];
  payment: { id: string; status: string; provider: string; isSimulated: boolean; amountPaise: number; refundedPaise: number; receiptNumber: string } | null;
  conversationId: string | null;
  myReview: { rating: number; comment: string | null } | null;
  viewerRole: "driver" | "passenger" | "staff";
  passenger: PublicProfile | null;
  ride: {
    id: string;
    status: Ride["status"];
    origin: string;
    destination: string;
    departureAt: string;
    estArrivalAt: string;
    driver: PublicProfile;
    vehicle: { make: string; model: string; color: string; plateNumber: string | null } | null;
    locationSharing: boolean;
    routeIsEstimate: boolean;
  };
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  color: string;
  plateNumber: string;
  seats: number;
  fuelType: string | null;
  year: number | null;
  isDemo: boolean;
  verification: VerificationItem & { insuranceExpiry?: string };
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
  read_at: string | null;
  created_at: string;
}

export interface Meta {
  environment: string;
  demoMode: boolean;
  serviceArea: { name: string; center: { lat: number; lng: number }; radius_km: number };
  features: { recurring_commutes: boolean; women_only_rides: boolean; chat: boolean; live_location: boolean };
  safety: { emergencyNumber: string; emergencyLabel: string };
  pricing: { suggested_paise_per_km: number; minimum_paise: number; max_multiple_of_suggested: number };
  fees: { platform_fee_percent: number; platform_fee_min_paise: number };
  cancellation: { free_until_minutes_before: number; late_refund_percent: number; driver_cancel_refund_percent: number };
  booking: { default_cutoff_minutes: number; request_expiry_minutes: number; payment_window_minutes: number; max_seats_per_booking: number };
  matching: { max_pickup_km: number; max_dropoff_km: number; time_window_minutes: number; weights: Record<string, number> };
  providers: { maps: { name: string; live: boolean }; payments: { name: string; live: boolean }; otpDevMode: boolean };
}

export interface Paged<T> {
  items: T[];
}
