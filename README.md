# BRASS+ ✚ 拡張機能パック

[BRASS+](https://brass-plus.onrender.com) に追加する、4つの新機能のソースコード一式です。
**このZIPは本体アプリには未組み込みのデモ実装です。** 以下の手順で Render に追加デプロイすると使えるようになります(本体の Render サービス・リポジトリは変更しません)。

## 収録機能

| 機能 | 内容 |
|---|---|
| 📊 出席率 | パート別・個人別の出席率を棒グラフ+バーで可視化。連続出席ストリーク、個人目標90%達成演出。出席表はタップで 出席→遅刻→欠席→公欠→クリア を切替(遅刻は0.5点換算) |
| 🎯 月一目標 | みんなから案を募集 → 投票(1人1票・タップで取消可) → 得票1位の案を「決定」で正式な月一目標に(月1件)。AI提案API付き(環境変数 `AI_API_KEY` が無い場合は内蔵ローカル提案が動作) |
| 🩺 体調管理 | 毎日の体調・睡眠時間・唇と息の調子を顔文字で記録。1週間の傾向から「2日連続体調不良」「睡眠不足」「唇の不調」を自動アラート。**医療アドバイスではありません**(画面内にも注意書きあり) |
| 💬 お悩み相談室 | 匿名OKの相談掲示板。返信・通報(2回で自動非表示)・本人または管理パスコードで削除。NGワードフィルター搭載。**深刻な悩みは大人に相談するよう案内を常時表示** |

デザインは本体 BRASS+ に合わせ、ミントグリーン(#6b8f8a)・カードUI・ピルボタンで統一しています。

## ファイル構成

```
brass-plus-ext/
├─ server.js          # Expressサーバー本体(API + 静的配信)
├─ package.json       # 依存は express のみ(Node 18+)
├─ render.yaml        # Renderでの新規サービス作成用
├─ db.json            # データ保存先(自動生成。消すと初期化されます)
└─ public/
   └─ index.html      # フロントエンド(単一HTML・vanilla JS)
```

## 使い方A: まずデモで触ってみる(ローカル)

```bash
npm install
npm start
# → http://localhost:3000 を開く
```

## 使い方B: Renderに新サービスとして追加(推奨)

本体とは別の新しい Web Service を作成する手順です。

1. GitHubに新しいリポジトリ(例: `brass-plus-ext`)を作り、このZIPの中身をすべてアップロード
2. Renderダッシュボード → **New +** → **Web Service** → 作成したリポジトリを選択
3. 設定は `render.yaml` のとおり:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. **Environment** タブで必要に応じて環境変数を設定(下表)
5. **Create Web Service** → 発行された `https://xxxx.onrender.com` が拡張機能のURL
6. 部員にURLを共有(本体アプリの自己紹介カード等にリンクを貼るのがおすすめ)

※ Render無料プランは**15分アクセスがないとスリープ**し、再アクセス時に数十秒かかります。また無料プランのディスクは**再デプロイで初期化**されるため、データを残したい場合は有料の Persistent Disk を追加するか、定期的に `db.json` をバックアップしてください。

## 環境変数(すべて任意)

| 変数名 | 説明 | 未設定時の動作 |
|---|---|---|
| `AI_API_KEY` | OpenAI互換APIのキー。設定すると月一目標のAI提案が有効化 | 内蔵ローカル提案(ルールベース)で動作 |
| `AI_API_BASE` | APIベースURL(例: `https://api.openai.com/v1`) | `https://api.openai.com/v1` |
| `AI_MODEL` | モデル名 | `gpt-4o-mini` |
| `MOD_PASSCODE` | 相談室の管理パスコード。設定すると `?passcode=` 付きで全投稿を削除可能 | 管理者削除は不可 |
| `NG_WORDS` | カンマ区切りの禁止ワード | `死ね,しね,消えろ,キモい` |
| `DATA_DIR` | `db.json` の保存先ディレクトリ(RenderのDiskをマウントした場合に指定) | アプリのディレクトリ |
| `PORT` | 待ち受けポート | Renderが自動設定 |

## API一覧(開発者向け)

| メソッド | パス | 概要 |
|---|---|---|
| GET | `/api/health` | 動作確認 |
| GET/POST/DELETE | `/api/members` | メンバー(名前・パート)管理 |
| GET/POST | `/api/attendance` | 出席記録(`?month=YYYY-MM` で月絞込) |
| GET/POST/DELETE | `/api/goal-ideas` | 目標案の取得・投稿・削除 |
| POST | `/api/goal-ideas/:id/vote` | 投票トグル |
| POST | `/api/goal-ideas/finalize` | 月一目標の決定(月1件に上書き) |
| POST | `/api/goal-ideas/ai-suggest` | AI/ローカルによる目標案の提案 |
| GET/POST | `/api/health-logs` | 体調記録(`?name=` で個人絞込) |
| GET | `/api/health-alerts` | ルールベースの体調アラート |
| GET/POST/DELETE | `/api/consults` | 相談の取得・投稿・削除 |
| POST | `/api/consults/:id/reply` | 返信 |
| POST | `/api/consults/:id/flag` | 通報(2回で非表示) |

### 本体BRASS+とデータ連携したい場合(上級者向け)
本体は `/api/groups/:code` 系の同期APIでメンバーとパートを管理しています。拡張機能の `POST /api/members` に本体のメンバー情報を流し込む、または `public/index.html` の `state.parts` を本体のパート名に合わせることで、パート別集計が本体の編成と一致します。
