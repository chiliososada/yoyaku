/**
 * 予約ドメインの型定義。
 * ドメイン層は「純粋」: DB/Prisma に依存しない。サービス層が取得したデータを渡す。
 * すべての Date は UTC instant。
 */

/** 既存予約が占有する区間（リソース競合判定の入力）。 */
export interface OccupiedInterval {
  /** 占有開始（UTC、buffer-before 含む） */
  start: Date;
  /** 占有終了（UTC、buffer-after 含む、半開区間 [start, end)） */
  end: Date;
  staffId: string | null;
  serviceId: string;
}

/** ある暦日に有効な営業区間（UTC instant の半開区間）。 */
export interface OpenInterval {
  start: Date;
  end: Date;
}

/** 暦日の営業判定結果。 */
export type DayStatus =
  | 'OPEN' // 通常営業
  | 'REGULAR_CLOSED' // 定休日（曜日）
  | 'HOLIDAY_CLOSED' // 祝日休業
  | 'TEMP_CLOSED' // 臨時休業
  | 'SPECIAL_OPEN'; // 特別営業

/** サービスの占有定義（1セグメント）。複数で多時間帯占有を表す。 */
export interface OccupancySegment {
  /** サービス開始からのオフセット（分） */
  offsetMin: number;
  /** このセグメントの長さ（分） */
  durationMin: number;
}

/** 容量・予約条件を解決した結果（shop/service/staff の各ルールを統合）。 */
export interface ResolvedBookingRules {
  slotIntervalMin: number;
  bookingWindowDays: number;
  leadTimeMinHours: number;
  cancellationDeadlineHours: number;
  /** 店舗レベルの同時受付上限 */
  shopCapacity: number;
  /** サービスレベルの同時受付上限 */
  serviceCapacity: number;
  /** スタッフ1人あたりの同時受付上限（通常1） */
  staffCapacity: number;
}

/** スロットが予約不可な理由。 */
export type SlotUnavailableReason =
  | 'SLOT_FULL' // 満席（容量超過）
  | 'OUTSIDE_BUSINESS_HOURS' // 営業時間外
  | 'STAFF_UNAVAILABLE' // 指名スタッフのシフト外/埋まり
  | 'LEAD_TIME_VIOLATION' // 締切（開始 N 時間前）を過ぎている
  | 'BOOKING_WINDOW_EXCEEDED'; // 受付期間（N 日先）を超えている

/** 計算済みの1スロット。 */
export interface SlotAvailability {
  /** 顧客に提示する開始時刻（UTC、サービス開始 = buffer-before を除く） */
  startAt: Date;
  /** サービス終了（buffer 除く、表示用） */
  serviceEndAt: Date;
  /** 占有終了（buffer-after 含む） */
  endAt: Date;
  available: boolean;
  /** 残り受付可能数（各制約の最小値）。0 で満席。 */
  remaining: number;
  reason?: SlotUnavailableReason;
}

/** スタッフの当日稼働区間（シフト解決結果、UTC）。 */
export interface StaffWorkingInterval {
  staffId: string;
  start: Date;
  end: Date;
}

/** 連続予約チェーンの1サービス分（コンボ予約用）。オプション延長は segments に適用済みで渡す。 */
export interface ChainPart {
  serviceId: string;
  segments: OccupancySegment[];
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** このサービスの同時受付上限（service 容量） */
  capacity: number;
}

/** availability 計算の入力一式（サービス層が DB から組み立てて渡す）。 */
export interface AvailabilityInput {
  /** 対象サービスID（service 容量の集計対象を絞るのに使用） */
  serviceId: string;
  /** 対象の店舗ローカル暦日 yyyy-MM-dd */
  date: string;
  timeZone: string;
  /** その日の有効営業区間（休業日なら空配列） */
  openIntervals: OpenInterval[];
  dayStatus: DayStatus;
  /** サービスの占有セグメント定義 */
  segments: OccupancySegment[];
  /** buffer（分） */
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** コンボ予約: 複数サービスを順に連結して1枠として判定する。
   *  指定時は serviceId/segments/buffer を無視し、この配列が占有と service 容量判定の権威となる。 */
  services?: ChainPart[];
  rules: ResolvedBookingRules;
  /** 指名スタッフID（null=おまかせ） */
  staffId: string | null;
  /** 指名おまかせ時の候補スタッフ群 */
  candidateStaffIds: string[];
  /**
   * 担当スタッフが必須のサービスか。
   * これが無いと「スタッフ不要」と「必須だが候補0人」を区別できず、後者が
   * 全枠「空きあり」に見えて確定ボタンでだけ失敗する（客も店主も原因が分からない）。
   */
  requiresStaff?: boolean;
  /** 当日の各スタッフ稼働区間（おまかせ時の供給上限算出に使用） */
  staffWorkingIntervals: StaffWorkingInterval[];
  /** 当日の店舗全体の既存占有区間（active な booking_items 由来、serviceId/staffId 付き）。
   *  shop容量は全件、service容量は serviceId 一致分、staff容量は staffId 一致分で集計する。 */
  occupied: OccupiedInterval[];
  /** 現在時刻（UTC、lead-time / window 判定用） */
  now: Date;
  /**
   * 締切（lead time）と受付期間（window）を適用するか。既定 true。
   * false にするのは**店主自身が後台から代理登録する**とき。
   * これらは「客がネットから駆け込み予約するのを防ぐ」ためのルールであり、
   * 電話を受けた店主が今日の予約を入れる行為まで止めると、日常業務が回らない。
   * 容量・防超卖・営業時間・スタッフ稼働の判定は false でも通常どおり効く。
   */
  enforceTimeRules?: boolean;
}
