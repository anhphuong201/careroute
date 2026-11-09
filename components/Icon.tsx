/**
 * Simple line icons (Lucide, ISC licence) – one visual language instead of colourful emoji.
 * Usage: <I n="pill" />  ·  decorative by default (aria-hidden); pass label for meaning-carrying icons.
 */
import {
  Activity, Ambulance, ArrowLeft, ArrowRight, ArrowUpRight, Brain, Building2, Bus, Calendar, CalendarPlus, Car, Check,
  ChevronDown, ChevronUp, CircleCheck, Clock, Copy, Droplet, FileText, FlaskConical, Globe, HeartPulse, History, Hospital,
  House, Info, Languages, Link, Lock, Map, MapPin, MessageCircle, Navigation, Pencil, Phone, Pill, Plus, Search, Siren,
  Stethoscope, Thermometer, TriangleAlert, User, UserRound, Users, Video, Wind, X, Zap, Bandage, type LucideIcon,
} from "lucide-react";

const ICONS = {
  pill: Pill, clinic: Hospital, ambulance: Ambulance, building: Building2, steth: Stethoscope, video: Video, phone: Phone,
  doctor: UserRound, lab: FlaskConical, bandage: Bandage, search: Search, home: House, history: History, plus: Plus,
  family: Users, file: FileText, globe: Globe, pin: MapPin, cal: Calendar, calPlus: CalendarPlus, clock: Clock, bus: Bus,
  car: Car, info: Info, check: Check, checkCircle: CircleCheck, down: ChevronDown, up: ChevronUp, alert: TriangleAlert,
  chat: MessageCircle, heart: HeartPulse, lungs: Wind, brain: Brain, drop: Droplet, thermo: Thermometer, bolt: Zap,
  map: Map, user: User, edit: Pencil, close: X, lock: Lock, copy: Copy, ext: ArrowUpRight, back: ArrowLeft,
  next: ArrowRight, siren: Siren, lang: Languages, nav: Navigation, link: Link, activity: Activity,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function I({ n, size, label, className }: { n: IconName | string; size?: number; label?: string; className?: string }) {
  const Cmp = ICONS[n as IconName] ?? Info;
  return (
    <Cmp
      className={`ic ${className ?? ""}`}
      size={size ?? 18}
      strokeWidth={1.9}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable={false}
    />
  );
}
