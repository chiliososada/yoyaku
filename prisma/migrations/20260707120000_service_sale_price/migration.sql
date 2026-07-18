-- セール価格（割引）。サービスに任意の割引価格を追加。
-- 設定時は予約の請求額がこの価格になり、公開予約ページで通常価格に取り消し線を表示する。
ALTER TABLE "services" ADD COLUMN "salePriceJpy" INTEGER;
