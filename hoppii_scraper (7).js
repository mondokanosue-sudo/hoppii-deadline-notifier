// ============================================
// hoppii(WebClass) 課題自動収集スクリプト
// ============================================
// 使い方:
// 1. hoppiiにログインした状態で、時間割ページを開く
//    (例: https://lms2025.hosei.ac.jp/webclass/ の授業一覧ページ)
// 2. F12 → Console タブを開く
// 3. このコード全体をコピーして貼り付け、Enterキーを押す
// 4. 数秒待つと、全授業の課題一覧がコンソールに表示され、
//    その後Makeへ自動送信されます
// ============================================

// ▼ここに、Makeで発行した自分のWebhook URLを入れてください
const WEBHOOK_URL = "YOUR_WEBHOOK_URL_HERE"; // 例: https://hook.us2.make.com/xxxxxxxxxxxxxxxxxxxxxxxx

async function collectAllAssignments() {
    console.log("=== 課題収集を開始します ===");

    // ステップ1: 時間割ページから全授業へのリンクを取得
    const courseLinks = Array.from(document.querySelectorAll('a.list-group-item.course'))
        .map(a => a.href)
        .filter((href, index, self) => self.indexOf(href) === index); // 重複除去

    console.log(`授業数: ${courseLinks.length}件のリンクを取得しました`);
    console.log(courseLinks);

    const allAssignments = [];

    // ステップ2: 各授業ページを順番に取得して解析
    for (const link of courseLinks) {
        try {
            console.log(`取得中: ${link}`);

            // 1回目のアクセス(トークン検証)
            const response = await fetch(link, {
                credentials: 'include' // ログイン中のCookieをそのまま使う
            });
            let html = await response.text();

            // JavaScriptによるリダイレクト(window.location.href = "...")を検出
            const redirectMatch = html.match(/window\.location\.href\s*=\s*"([^"]+)"/);
            let courseUrl = link;

            if (redirectMatch) {
                // リダイレクト先(新しいトークン付きURL)へ2回目のアクセス
                courseUrl = new URL(redirectMatch[1], link).href;
                const response2 = await fetch(courseUrl, { credentials: 'include' });
                html = await response2.text();
            }

            // ステップ3: 取得したHTMLをパースして課題情報を抽出
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 授業名を取得(ページタイトルから)
            const courseName = doc.querySelector('title')
                ? doc.querySelector('title').textContent.split(' - ')[0]
                : '不明な授業';

            // 各課題ブロックを取得
            const contentBlocks = doc.querySelectorAll('.cl-contentsList_content');

            contentBlocks.forEach(block => {
                const categoryLabelEl = block.querySelector('.cl-contentsList_categoryLabel');
                const categoryLabel = categoryLabelEl ? categoryLabelEl.textContent.trim() : '';

                // 「資料」というラベルは除外(提出不要な閲覧資料のため)
                if (categoryLabel.includes('資料')) {
                    return;
                }

                const titleEl = block.querySelector('.cm-contentsList_contentName div');
                const title = titleEl ? titleEl.textContent.trim() : '(タイトル不明)';

                const periodEl = block.querySelector('.cm-contentsList_contentDetailListItemData');
                const period = periodEl ? periodEl.textContent.trim() : '';

                // 期間から終了日時(締切)だけを抜き出す
                // 例: "2026/05/12 10:46 - 2026/05/12 12:30" → "2026/05/12 12:30"
                let deadline = '';
                let deadlineDate = null;
                if (period.includes(' - ')) {
                    deadline = period.split(' - ')[1].trim();
                    // "2026/05/12 12:30" のような形式をDateオブジェクトに変換
                    const normalized = deadline.replace(/\//g, '-').replace(' ', 'T');
                    deadlineDate = new Date(normalized);
                }

                allAssignments.push({
                    id: `${courseName}_${title}_${deadline}`, // 重複チェック用の一意ID
                    course: courseName,
                    title: title,
                    category: categoryLabel,
                    deadline: deadline,
                    deadlineDate: deadlineDate,
                    rawPeriod: period,
                    url: courseUrl
                });
            });

            // サーバーに負荷をかけすぎないよう、リクエスト間に少し間隔を空ける
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`エラー(${link}):`, error);
        }
    }

    console.log("=== 収集完了 ===");
    console.log(`合計 ${allAssignments.length} 件の課題を取得しました(過去分も含む)`);

    // ステップ4: 今より後の締切だけに絞り込む
    const now = new Date();
    const upcomingAssignments = allAssignments.filter(item => {
        return item.deadlineDate && item.deadlineDate > now;
    });

    console.log(`このうち、締切が未来のものは ${upcomingAssignments.length} 件です`);
    console.table(upcomingAssignments);

    return upcomingAssignments;
}

// Makeへ1件ずつ送信する関数
async function sendToMake(assignments) {
    console.log(`=== Makeへの送信を開始します(${assignments.length}件) ===`);

    let successCount = 0;
    let failCount = 0;

    for (const item of assignments) {
        try {
            const response = await fetch(WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: item.id,
                    course: item.course,
                    title: item.title,
                    category: item.category,
                    deadline: item.deadline,
                    url: item.url
                })
            });

            if (response.ok) {
                successCount++;
                console.log(`送信成功: ${item.title}`);
            } else {
                failCount++;
                console.error(`送信失敗(ステータス${response.status}): ${item.title}`);
            }

            // Makeに負荷をかけすぎないよう、送信間隔を空ける
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            failCount++;
            console.error(`送信エラー: ${item.title}`, error);
        }
    }

    console.log(`=== 送信完了 === 成功: ${successCount}件 / 失敗: ${failCount}件`);
}

// 実行(収集 → Makeへ送信)
collectAllAssignments().then(async assignments => {
    // グローバル変数に保存しておく(あとでコンソールから確認できるように)
    window.__hoppiiAssignments = assignments;
    console.log("結果は window.__hoppiiAssignments に保存されています");

    if (assignments.length === 0) {
        console.log("送信対象の課題がないため、Makeへの送信はスキップします");
        return;
    }

    await sendToMake(assignments);
});
