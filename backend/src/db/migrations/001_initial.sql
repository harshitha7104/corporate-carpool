-- Green Way initial schema. Money is integer paise. Times are timestamptz (UTC);
-- Bengaluru-local values (commute departure times) are stored with their zone.

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             text UNIQUE CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  email             text,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deactivated', 'deleted')),
  status_reason     text,
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CHECK (phone IS NOT NULL OR email IS NOT NULL OR status = 'deleted')
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE user_profiles (
  user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  full_name      text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 80),
  gender         text CHECK (gender IN ('female', 'male', 'non_binary', 'prefer_not_to_say')),
  bio            text CHECK (length(bio) <= 300),
  home_area      text,
  work_area      text,
  photo_file_id  uuid,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('passenger', 'driver', 'admin', 'support')),
  granted_by uuid REFERENCES users (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE user_preferences (
  user_id          uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  notify_email     boolean NOT NULL DEFAULT true,
  notify_sms       boolean NOT NULL DEFAULT true,
  notify_whatsapp  boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE otp_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel      text NOT NULL CHECK (channel IN ('sms', 'email')),
  destination  text NOT NULL,
  code_hash    text NOT NULL,
  attempts     int  NOT NULL DEFAULT 0,
  max_attempts int  NOT NULL DEFAULT 5,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz
);
CREATE INDEX otp_destination_idx ON otp_challenges (destination, created_at DESC);

-- Private uploaded documents. Contents live in file storage under storage_key.
CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose         text NOT NULL CHECK (purpose IN ('identity_document', 'driving_license', 'vehicle_rc', 'vehicle_insurance', 'profile_photo')),
  mime_type       text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes      int  NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256          text NOT NULL,
  storage_key     text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz,
  deleted_at      timestamptz
);

CREATE TABLE driver_profiles (
  user_id               uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  license_last4         text CHECK (license_last4 ~ '^[A-Z0-9]{4}$'),
  license_expiry        date,
  years_driving         smallint CHECK (years_driving BETWEEN 0 AND 70),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One row per submission. "Not submitted" is the absence of a row.
CREATE TABLE identity_verifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('government_id', 'driving_license')),
  document_type    text NOT NULL CHECK (document_type IN ('aadhaar', 'pan', 'passport', 'voter_id', 'driving_license')),
  document_last4   text CHECK (document_last4 ~ '^[A-Z0-9]{4}$'),
  document_file_id uuid REFERENCES files (id),
  status           text NOT NULL DEFAULT 'pending_review'
                   CHECK (status IN ('pending_review', 'verified', 'rejected', 'needs_info', 'expired')),
  reviewer_id      uuid REFERENCES users (id),
  reviewer_notes   text,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  expires_at       timestamptz
);
CREATE INDEX identity_verifications_user_idx ON identity_verifications (user_id, kind, submitted_at DESC);
CREATE INDEX identity_verifications_queue_idx ON identity_verifications (status, submitted_at);

CREATE TABLE vehicles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  make         text NOT NULL,
  model        text NOT NULL,
  color        text NOT NULL,
  plate_number text NOT NULL CHECK (plate_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$'),
  seats        smallint NOT NULL CHECK (seats BETWEEN 1 AND 7),
  fuel_type    text CHECK (fuel_type IN ('petrol', 'diesel', 'cng', 'electric', 'hybrid')),
  year         smallint CHECK (year BETWEEN 1990 AND 2100),
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX vehicles_plate_key ON vehicles (plate_number) WHERE deleted_at IS NULL;
CREATE INDEX vehicles_owner_idx ON vehicles (owner_id);

CREATE TABLE vehicle_verifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        uuid NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  rc_file_id        uuid REFERENCES files (id),
  insurance_file_id uuid REFERENCES files (id),
  insurance_expiry  date,
  status            text NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review', 'verified', 'rejected', 'needs_info', 'expired')),
  reviewer_id       uuid REFERENCES users (id),
  reviewer_notes    text,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz
);
CREATE INDEX vehicle_verifications_vehicle_idx ON vehicle_verifications (vehicle_id, submitted_at DESC);
CREATE INDEX vehicle_verifications_queue_idx ON vehicle_verifications (status, submitted_at);

CREATE TABLE saved_locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label      text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  address    text NOT NULL,
  lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_locations_user_idx ON saved_locations (user_id);

CREATE TABLE recurring_commute_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  vehicle_id            uuid NOT NULL REFERENCES vehicles (id),
  origin_label          text NOT NULL,
  origin_lat            double precision NOT NULL,
  origin_lng            double precision NOT NULL,
  destination_label     text NOT NULL,
  destination_lat       double precision NOT NULL,
  destination_lng       double precision NOT NULL,
  stops                 jsonb NOT NULL DEFAULT '[]',
  days_of_week          smallint[] NOT NULL CHECK (cardinality(days_of_week) BETWEEN 1 AND 7 AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  departure_time        time NOT NULL,
  timezone              text NOT NULL DEFAULT 'Asia/Kolkata',
  start_date            date NOT NULL,
  end_date              date,
  skip_dates            date[] NOT NULL DEFAULT '{}',
  seats_total           smallint NOT NULL CHECK (seats_total BETWEEN 1 AND 7),
  price_per_seat_paise  int NOT NULL CHECK (price_per_seat_paise >= 0),
  booking_mode          text NOT NULL CHECK (booking_mode IN ('instant', 'request')),
  booking_cutoff_minutes int NOT NULL DEFAULT 30 CHECK (booking_cutoff_minutes BETWEEN 0 AND 1440),
  women_only            boolean NOT NULL DEFAULT false,
  luggage               text NOT NULL DEFAULT 'small' CHECK (luggage IN ('none', 'small', 'medium', 'large')),
  notes                 text CHECK (length(notes) <= 500),
  preferences           jsonb NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  generated_through     date,
  is_demo               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX recurring_rules_driver_idx ON recurring_commute_rules (driver_id);

-- A ride is one bookable trip on one date. Recurring rules generate rides;
-- (recurring_rule_id, service_date) is unique so a retried job cannot duplicate.
CREATE TABLE rides (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id              uuid NOT NULL REFERENCES users (id),
  vehicle_id             uuid NOT NULL REFERENCES vehicles (id),
  recurring_rule_id      uuid REFERENCES recurring_commute_rules (id) ON DELETE SET NULL,
  service_date           date,
  status                 text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'published', 'in_progress', 'completed', 'cancelled')),
  origin_label           text NOT NULL,
  origin_lat             double precision NOT NULL,
  origin_lng             double precision NOT NULL,
  destination_label      text NOT NULL,
  destination_lat        double precision NOT NULL,
  destination_lng        double precision NOT NULL,
  departure_at           timestamptz NOT NULL,
  est_arrival_at         timestamptz NOT NULL,
  distance_m             int NOT NULL CHECK (distance_m > 0),
  duration_s             int NOT NULL CHECK (duration_s > 0),
  route_source           text NOT NULL CHECK (route_source IN ('estimate', 'mapbox')),
  route_geometry         jsonb NOT NULL,
  seats_total            smallint NOT NULL CHECK (seats_total BETWEEN 1 AND 7),
  price_per_seat_paise   int NOT NULL CHECK (price_per_seat_paise >= 0),
  suggested_price_paise  int NOT NULL CHECK (suggested_price_paise >= 0),
  booking_mode           text NOT NULL CHECK (booking_mode IN ('instant', 'request')),
  booking_cutoff_minutes int NOT NULL DEFAULT 30 CHECK (booking_cutoff_minutes BETWEEN 0 AND 1440),
  women_only             boolean NOT NULL DEFAULT false,
  luggage                text NOT NULL DEFAULT 'small' CHECK (luggage IN ('none', 'small', 'medium', 'large')),
  notes                  text CHECK (length(notes) <= 500),
  preferences            jsonb NOT NULL DEFAULT '{}',
  location_sharing       boolean NOT NULL DEFAULT false,
  cancel_reason          text,
  is_demo                boolean NOT NULL DEFAULT false,
  published_at           timestamptz,
  started_at             timestamptz,
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recurring_rule_id, service_date),
  CHECK (est_arrival_at > departure_at)
);
CREATE INDEX rides_search_idx ON rides (status, departure_at);
CREATE INDEX rides_driver_idx ON rides (driver_id, departure_at DESC);

CREATE TABLE ride_stops (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id        uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  seq            smallint NOT NULL,
  label          text NOT NULL,
  lat            double precision NOT NULL,
  lng            double precision NOT NULL,
  offset_minutes int NOT NULL DEFAULT 0 CHECK (offset_minutes >= 0),
  UNIQUE (ride_id, seq)
);

-- Seats are only ever changed inside a transaction holding this row's lock.
CREATE TABLE seat_inventory (
  ride_id        uuid PRIMARY KEY REFERENCES rides (id) ON DELETE CASCADE,
  seats_total    smallint NOT NULL,
  seats_reserved smallint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (seats_reserved >= 0 AND seats_reserved <= seats_total)
);

CREATE TABLE bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id            uuid NOT NULL REFERENCES rides (id),
  passenger_id       uuid NOT NULL REFERENCES users (id),
  seats              smallint NOT NULL CHECK (seats BETWEEN 1 AND 6),
  status             text NOT NULL CHECK (status IN (
                       'REQUESTED', 'ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED',
                       'REJECTED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER',
                       'EXPIRED', 'NO_SHOW', 'DISPUTED')),
  seats_held         boolean NOT NULL DEFAULT false,
  pickup_label       text NOT NULL,
  pickup_lat         double precision NOT NULL,
  pickup_lng         double precision NOT NULL,
  dropoff_label      text NOT NULL,
  dropoff_lat        double precision NOT NULL,
  dropoff_lng        double precision NOT NULL,
  pickup_eta_at      timestamptz,
  detour_m           int,
  contribution_paise int NOT NULL CHECK (contribution_paise >= 0),
  platform_fee_paise int NOT NULL DEFAULT 0 CHECK (platform_fee_paise >= 0),
  total_paise        int NOT NULL CHECK (total_paise >= 0),
  message            text CHECK (length(message) <= 300),
  idempotency_key    text NOT NULL,
  expires_at         timestamptz,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  accepted_at        timestamptz,
  confirmed_at       timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (passenger_id, idempotency_key)
);
-- One live booking per passenger per ride.
CREATE UNIQUE INDEX bookings_one_active_idx ON bookings (ride_id, passenger_id)
  WHERE status IN ('REQUESTED', 'ACCEPTED', 'CONFIRMED', 'IN_PROGRESS');
CREATE INDEX bookings_passenger_idx ON bookings (passenger_id, created_at DESC);
CREATE INDEX bookings_ride_idx ON bookings (ride_id);
CREATE INDEX bookings_expiry_idx ON bookings (status, expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE booking_events (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor_id    uuid REFERENCES users (id),
  actor_role  text NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, created_at);

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          uuid NOT NULL REFERENCES bookings (id),
  payer_id            uuid NOT NULL REFERENCES users (id),
  provider            text NOT NULL CHECK (provider IN ('simulated', 'razorpay')),
  provider_order_id   text NOT NULL,
  provider_payment_id text,
  status              text NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created', 'captured', 'failed', 'refunded', 'partially_refunded')),
  amount_paise        int NOT NULL CHECK (amount_paise > 0),
  platform_fee_paise  int NOT NULL DEFAULT 0 CHECK (platform_fee_paise >= 0),
  provider_fee_paise  int NOT NULL DEFAULT 0 CHECK (provider_fee_paise >= 0),
  driver_share_paise  int NOT NULL CHECK (driver_share_paise >= 0),
  refunded_paise      int NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0),
  currency            text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  idempotency_key     text NOT NULL,
  receipt_number      text NOT NULL UNIQUE,
  failure_reason      text,
  captured_at         timestamptz,
  is_demo             boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_order_id),
  UNIQUE (payer_id, idempotency_key),
  CHECK (refunded_paise <= amount_paise)
);
CREATE INDEX payments_booking_idx ON payments (booking_id);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL REFERENCES payments (id),
  amount_paise       int NOT NULL CHECK (amount_paise > 0),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  reason             text NOT NULL,
  provider_refund_id text,
  initiated_by       uuid REFERENCES users (id),
  failure_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz
);
CREATE INDEX refunds_payment_idx ON refunds (payment_id);

CREATE TABLE payment_webhook_events (
  id               bigserial PRIMARY KEY,
  provider         text NOT NULL,
  event_id         text NOT NULL,
  event_type       text NOT NULL,
  signature_valid  boolean NOT NULL,
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  processing_error text,
  UNIQUE (provider, event_id)
);

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings (id),
  ride_id     uuid NOT NULL REFERENCES rides (id),
  reviewer_id uuid NOT NULL REFERENCES users (id),
  reviewee_id uuid NOT NULL REFERENCES users (id),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text CHECK (length(comment) <= 500),
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, reviewer_id),
  CHECK (reviewer_id <> reviewee_id)
);
CREATE INDEX reviews_reviewee_idx ON reviews (reviewee_id);

CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users (id),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  provider        text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed', 'not_configured', 'logged_dev')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_deliveries_retry_idx ON notification_deliveries (status, next_attempt_at);

CREATE TABLE trusted_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  phone        text NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  relationship text CHECK (length(relationship) <= 30),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trusted_contacts_user_idx ON trusted_contacts (user_id);

CREATE TABLE trip_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trip_locations (
  id          bigserial PRIMARY KEY,
  ride_id     uuid NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id),
  lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m  int,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_locations_ride_idx ON trip_locations (ride_id, recorded_at DESC);

CREATE TABLE user_blocks (
  blocker_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE favourite_drivers (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  driver_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, driver_id),
  CHECK (user_id <> driver_id)
);

-- A passenger's regular trip, used to suggest matching rides and commutes.
CREATE TABLE passenger_commutes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  origin_label      text NOT NULL,
  origin_lat        double precision NOT NULL,
  origin_lng        double precision NOT NULL,
  destination_label text NOT NULL,
  destination_lat   double precision NOT NULL,
  destination_lng   double precision NOT NULL,
  days_of_week      smallint[] NOT NULL CHECK (cardinality(days_of_week) BETWEEN 1 AND 7),
  window_start      time NOT NULL,
  window_end        time NOT NULL,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end > window_start)
);
CREATE INDEX passenger_commutes_user_idx ON passenger_commutes (user_id);

CREATE TABLE safety_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     uuid NOT NULL REFERENCES users (id),
  subject_user_id uuid REFERENCES users (id),
  ride_id         uuid REFERENCES rides (id),
  booking_id      uuid REFERENCES bookings (id),
  category        text NOT NULL CHECK (category IN ('unsafe_driving', 'harassment', 'no_show', 'fraud', 'vehicle_mismatch', 'payment_dispute', 'emergency', 'other')),
  severity        text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description     text NOT NULL CHECK (length(description) BETWEEN 10 AND 2000),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  assigned_to     uuid REFERENCES users (id),
  resolution      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_reports_status_idx ON safety_reports (status, severity, created_at);

CREATE TABLE support_tickets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id),
  category          text NOT NULL CHECK (category IN ('booking', 'payment', 'safety', 'account', 'verification', 'other')),
  subject           text NOT NULL CHECK (length(subject) BETWEEN 3 AND 120),
  description       text NOT NULL CHECK (length(description) BETWEEN 10 AND 4000),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed')),
  priority          text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to       uuid REFERENCES users (id),
  booking_id        uuid REFERENCES bookings (id),
  safety_report_id  uuid REFERENCES safety_reports (id),
  escalated         boolean NOT NULL DEFAULT false,
  escalation_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_queue_idx ON support_tickets (status, priority, created_at);
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, created_at DESC);

CREATE TABLE support_ticket_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users (id),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  internal   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_messages_ticket_idx ON support_ticket_messages (ticket_id, created_at);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users (id),
  actor_role  text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}',
  ip          text,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE TABLE platform_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE search_events (
  id                bigserial PRIMARY KEY,
  user_id           uuid REFERENCES users (id) ON DELETE SET NULL,
  origin_label      text,
  destination_label text,
  results_count     int NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_events_created_idx ON search_events (created_at);

CREATE TABLE idempotency_keys (
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key             text NOT NULL,
  endpoint        text NOT NULL,
  request_hash    text NOT NULL,
  response_status int,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint, key)
);

CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  dedupe_key   text UNIQUE,
  run_at       timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  last_error   text,
  locked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queue_idx ON jobs (status, run_at);

INSERT INTO platform_config (key, value) VALUES
  ('fees', '{"platform_fee_percent": 0, "platform_fee_min_paise": 0}'),
  ('pricing', '{"suggested_paise_per_km": 350, "minimum_paise": 3000, "max_multiple_of_suggested": 1.5}'),
  ('cancellation', '{"free_until_minutes_before": 120, "late_refund_percent": 50, "driver_cancel_refund_percent": 100}'),
  ('booking', '{"default_cutoff_minutes": 30, "request_expiry_minutes": 240, "payment_window_minutes": 30, "max_seats_per_booking": 4}'),
  ('matching', '{"max_pickup_km": 2.5, "max_dropoff_km": 2.5, "time_window_minutes": 90, "weights": {"overlap": 0.35, "detour": 0.25, "time": 0.25, "price": 0.15}}'),
  ('service_area', '{"name": "Bengaluru", "center": {"lat": 12.9716, "lng": 77.5946}, "radius_km": 45}'),
  ('safety', '{"emergency_number": "112", "emergency_label": "India emergency response (police, fire, ambulance)", "trip_share_hours": 12, "location_retention_days": 7}'),
  ('features', '{"recurring_commutes": true, "women_only_rides": true, "chat": true, "live_location": true}');
