# 三色六角碁 (Three Color Hex Go)

**黒・白・赤の3色で遊ぶ、六角格子の変則囲碁**。得点は陣地ではなく**終局時に盤上に残った自分の石数**だけです。

> v0.2 は独自ルールを検証する試作版。CPUは簡易的な対戦相手であり、強い囲碁AIではありません。

## 🎮 遊ぶ

GitHub Pages 公開設定完了後のURL：

**https://nao70161994.github.io/three-color-go/**

現時点でURLが開けない場合は、リポジトリの **Settings → Pages → Build and deployment → Source: GitHub Actions** を選択してください。公開後は `main` へのコミットで自動更新されます。対応ワークフローは `.github/workflows/pages.yml` です。

**GitHub Pagesを設定する前でも**、[play.html](play.html) をダウンロードしてブラウザで開けば、外部ファイルやネット接続なしで遊べます。Androidではダウンロードした `play.html` をブラウザで開いてください。ブラウザによってはローカルファイルへのアクセスが制限される場合があります。

ローカルでも遊べます。

```sh
git clone https://github.com/nao70161994/three-color-go.git
cd three-color-go
python3 -m http.server 8000
# http://localhost:8000/
```

- **1人で遊ぶ**：自分が黒、CPUが白と赤。CPUの石は自動着手します。
- **3人で交代**：同じ画面を3人で交代して操作します。
- 盤の空点をタップして石を置き、パス・一手戻す・リセットを操作できます。
- 対局はブラウザに自動保存されます（ストレージが利用可能な場合）。
- 対局中にモードを切り替えると、新規対局になります。

## ルール

| 項目 | 内容 |
| --- | --- |
| 人数 | 3人（黒→白→赤） |
| 盤面 | 正六角形。六角マスの中心に石を置く、**6方向接続**の格子 |
| 盤面サイズ | 通常は半径4／61マス。APIでは半径2〜10 |
| 石の連結 | 同色の石が6方向に隣接すると連結 |
| 捕獲 | 集団の空の隣接マス（呼吸点）がゼロになると取り除く。複数色による共同包囲も可 |
| 自殺手 | 禁止（相手を取り、呼吸点を作れる場合は合法） |
| コウ | **全局同形禁止**。パスは例外 |
| 終局 | 3人が連続でパス |
| 得点 | **盤上に残る石1個＝1点**。陣地・アゲハマ・コミは加点しない |
| 勝敗 | 石数最多の色が勝利。同点なら同点者全員が勝者 |

注意：盤上の「死に石」を終了後に自動判定する機能はありません。取る必要のある石は終局前に捕獲してください。

CPUはゲームを極端に長引かせないため、盤面のマス数の2倍の手数を過ぎるとパスする簡易方針です。**強制終局ではなくCPUの行動方針**です。

## 🤖 ChatGPT / Codex / その他AI向け：対局・動作確認

外部エージェントが状態を読み、合法手を選び、実際に打ち、テストできます。詳細は [AGENTS.md](AGENTS.md)。

### 1. ブラウザの操作API

公開サイトまたはローカルサイトを開き、ブラウザのJavaScript実行環境で：

```js
const go = window.threeColorGo;
go.reset({mode:'local',radius:3});
go.getState();            // JSON形式の盤面・手番・得点
go.legalMoves();          // [{q,r}, ...] 合法手一覧
go.play(0,0);             // 黒が(0,0)へ着手
go.pass();                // 現在の色がパス
go.undo();                // 1手戻す
go.exportRecord();        // 棋譜
go.importRecord(record);  // 棋譜を検証して復元
go.autoPlay(100,42);      // 簡易AIが最大100手進める。乱数シード42
```

盤のマスは `g.cell[data-q="0"][data-r="0"]` のような属性で自動操作できます。`getState()` はJSON化できるオブジェクトを返し、UIから独立して結果を確認できます。

### 2. Node.jsで1手ずつAIが対局（外部依存なし）

```sh
printf '%s\n' \
  '{"action":"new","radius":3}' \
  '{"action":"legal"}' \
  '{"action":"play","q":0,"r":0}' \
  '{"action":"state"}' \
  '{"action":"bot"}' \
  '{"action":"export"}' | node scripts/agent-play.mjs
```

入力は**1行1JSON**、出力も**1行1JSON**。利用できる操作は `new`, `state`, `legal`, `play`, `pass`, `undo`, `bot`, `export`, `import`, `simulate`。AIは合法手一覧を確認して任意の手を選べます。自動対局：

```sh
node scripts/agent-play.mjs --selfplay 20 --seed 42 --radius 3
```

20局の対局統計、終了状態、初回の棋譜がJSONで出力されます。

### 3. 自動テスト・実ブラウザ確認

```sh
npm test
```

追加インストール不要。手番、ルール、捕獲、コウ、終局、AI自動対局、JSONLプロトコルをテスト。

ブラウザの実際のDOMも操作する検証ページ：

**[tests/browser-smoke.html](tests/browser-smoke.html)**（公開サイトでは `/tests/browser-smoke.html`）

GitHub Actions の `tests` では、Node.js単体テストに加えてヘッドレスChromeで上記ページを開き、実際に着手・パス・Undo・CPUの着手・棋譜復元まで検証します。

## プロジェクト構成

- `index.html` — ゲームUI
- `src/game.js` — 純粋なルールエンジン
- `src/agent.js` — AI用盤面・合法手・簡易CPU・自動対局
- `src/main.js` — 画面ロジックと `window.threeColorGo`
- `scripts/agent-play.mjs` — AI対局用JSONL CLI
- `tests/` — 単体テスト・実ブラウザスモークテスト
- `.github/workflows/` — 自動テストとPagesデプロイ

## 今後の候補

オンライン3人対戦、より強いCPU、盤面サイズ選択UI、棋譜再生、試合ログ、バランス統計の可視化。

ライセンスは未指定です。
