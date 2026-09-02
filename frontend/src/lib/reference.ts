/**
 * The lists behind the dropdowns.
 *
 * Every one of these was a free-text box, which is why two people from the
 * same community could not be matched on it: one typed "Telugu", the next
 * "telegu", and the matching engine saw two different answers. A list is worth
 * having for exactly that reason, not for tidiness.
 *
 * These are starting points, expected to be edited. They live in one file so
 * that editing them is editing one file — and they are strings rather than
 * enums, so a change here needs no migration and no deployment coordination
 * with the database.
 *
 * Where a real list cannot be finite — sub-caste, gothram, and the places
 * people come from run to thousands and vary by region — the field pairs the
 * list with a free-text "Other" rather than pretending otherwise. A dropdown
 * that does not contain somebody's community is worse than a text box: it
 * tells them they do not exist.
 */

export const RELIGIONS = [
  'Hindu',
  'Muslim',
  'Christian',
  'Sikh',
  'Jain',
  'Buddhist',
  'Parsi',
  'Jewish',
  'Spiritual / No religion',
  'Other',
] as const;

/**
 * Castes offered per religion.
 *
 * Keyed by religion because offering a Hindu caste list to a Christian family
 * is not a neutral mistake. Religions with no caste structure map to an empty
 * list, and the field then offers only the free-text box.
 */
export const CASTES_BY_RELIGION: Record<string, string[]> = {
  Hindu: [
    'Brahmin', 'Kamma', 'Kapu', 'Reddy', 'Raju', 'Velama', 'Vysya', 'Balija',
    'Ezhava', 'Gowda', 'Jat', 'Kayastha', 'Khatri', 'Lingayat', 'Maratha',
    'Nair', 'Nadar', 'Patel', 'Rajput', 'Yadav', 'Mudaliar', 'Chettiar',
    'Gupta', 'Agarwal', 'Thevar', 'Vanniyar', 'Scheduled Caste',
    'Scheduled Tribe', 'Other',
  ],
  Muslim: ['Sunni', 'Shia', 'Dawoodi Bohra', 'Ismaili', 'Memon', 'Ansari', 'Other'],
  Christian: [
    'Roman Catholic', 'Protestant', 'Orthodox', 'Syrian Catholic',
    'Syro Malabar', 'Marthoma', 'Pentecostal', 'Baptist', 'Other',
  ],
  Sikh: ['Jat', 'Khatri', 'Ramgarhia', 'Arora', 'Ahluwalia', 'Other'],
  Jain: ['Digambar', 'Shwetambar', 'Other'],
  Buddhist: ['Other'],
  Parsi: ['Other'],
  Jewish: ['Other'],
  'Spiritual / No religion': [],
  Other: [],
};

export const MOTHER_TONGUES = [
  'Telugu', 'Hindi', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Gujarati',
  'Bengali', 'Punjabi', 'Odia', 'Assamese', 'Urdu', 'Konkani', 'Tulu',
  'Kashmiri', 'Sindhi', 'Nepali', 'English', 'Other',
] as const;

/**
 * Exactly the list given in the requirements, in the order it was given.
 *
 * Kept in that order deliberately: it is somebody's considered list, and
 * re-sorting it alphabetically would quietly lose whatever thought went into
 * it. Used for the profile, both parents, and siblings.
 */
export const PROFESSIONS = [
  'Government Employee',
  'Private Employee',
  'Business Owner',
  'Self-Employed',
  'Doctor',
  'Engineer',
  'Teacher / Professor',
  'Lawyer',
  'Accountant / Finance',
  'IT / Software Professional',
  'Banking Professional',
  'Healthcare Professional',
  'Civil Services',
  'Police / Defence',
  'Farmer / Agriculture',
  'Skilled Worker',
  'Retired',
  'Homemaker',
  'Student',
  'Unemployed',
  'Freelancer',
  'Other',
] as const;

export const QUALIFICATIONS = [
  'Below 10th', '10th / SSC', '12th / Intermediate', 'Diploma',
  'Bachelor of Arts', 'Bachelor of Science', 'Bachelor of Commerce',
  'Bachelor of Engineering / Technology', 'Bachelor of Medicine (MBBS)',
  'Bachelor of Dental Surgery', 'Bachelor of Pharmacy', 'Bachelor of Law',
  'Bachelor of Education', 'Bachelor of Architecture', 'BCA',
  'Master of Arts', 'Master of Science', 'Master of Commerce',
  'Master of Engineering / Technology', 'MBA / PGDM', 'MCA',
  'Master of Medicine (MD / MS)', 'Master of Law', 'Chartered Accountant',
  'Company Secretary', 'Doctorate / PhD', 'Other',
] as const;

/** The twelve rashis, in the traditional order. */
export const RASHIS = [
  'Mesha (Aries)', 'Vrishabha (Taurus)', 'Mithuna (Gemini)', 'Karka (Cancer)',
  'Simha (Leo)', 'Kanya (Virgo)', 'Tula (Libra)', 'Vrischika (Scorpio)',
  'Dhanu (Sagittarius)', 'Makara (Capricorn)', 'Kumbha (Aquarius)',
  'Meena (Pisces)',
] as const;

/** All twenty-seven nakshatras, in order. */
export const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra',
  'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni',
  'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha',
  'Jyeshtha', 'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana',
  'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada',
  'Revati',
] as const;

/** A nakshatra has four padas. Stored as text because everything else is. */
export const PADAMS = ['1', '2', '3', '4'] as const;

export const KUJA_DOSHAM = ['Yes', 'No', 'Unknown'] as const;

/**
 * Cities offered as suggestions, not as a limit.
 *
 * India has thousands of towns and people marry across all of them, so this is
 * the head of a long tail and the field stays free text underneath. It exists
 * so that the common case is one tap and spelled the same way twice.
 */
export const CITIES = [
  'Hyderabad', 'Bengaluru', 'Chennai', 'Mumbai', 'Delhi', 'Pune', 'Kolkata',
  'Ahmedabad', 'Jaipur', 'Lucknow', 'Kochi', 'Coimbatore', 'Visakhapatnam',
  'Vijayawada', 'Warangal', 'Guntur', 'Nellore', 'Tirupati', 'Mysuru',
  'Madurai', 'Trichy', 'Thiruvananthapuram', 'Nagpur', 'Indore', 'Bhopal',
  'Chandigarh', 'Surat', 'Vadodara', 'Bhubaneswar', 'Guwahati', 'Patna',
  'Ranchi', 'Raipur', 'Dehradun', 'Amritsar', 'Ludhiana',
] as const;

export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

export const COUNTRIES = [
  'India', 'United States', 'United Kingdom', 'Canada', 'Australia',
  'United Arab Emirates', 'Singapore', 'Malaysia', 'New Zealand', 'Germany',
  'Ireland', 'Qatar', 'Saudi Arabia', 'Kuwait', 'Oman', 'South Africa',
  'Other',
] as const;

/** What the free-text escape is labelled, everywhere it appears. */
export const OTHER = 'Other';

/**
 * Whether a stored value needs the free-text box shown alongside the list.
 *
 * A profile saved before these lists existed holds whatever somebody typed, and
 * that value must survive being opened and saved again. So anything not on the
 * list is treated as an "Other" that has already been filled in, rather than
 * being silently dropped on the next save.
 */
export function isOffList(value: string | null | undefined, options: readonly string[]): boolean {
  if (!value) return false;
  return !options.includes(value);
}
