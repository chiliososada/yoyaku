-- セッションの即時失効を可能にする世代番号。
-- JWT セッションはサーバー側に状態を持たないため、停止・ログイン無効化・パスワード
-- リセットをしても既発行トークンが有効期限（既定30日）まで生き続ける穴があった。
-- users.sessionEpoch を JWT に刻印し、リクエスト毎に DB と照合、不一致なら失効扱いにする。
-- 上記操作時にこの値を +1 することで、該当ユーザーの既存セッションを即座に無効化する。
ALTER TABLE "users" ADD COLUMN "sessionEpoch" INTEGER NOT NULL DEFAULT 0;
