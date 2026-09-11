import { COORD_MAX, COORD_MIN } from './types.js';
import { isBearingSegment, isTrivialFacility, looksLikeDescription } from './path.js';
/**
 * 条目名以这些词开头 → 算地点类条目。
 *
 * 注意「地点」和「势力」是**裸前缀**（不要求后面跟冒号）：整理世界书时
 * `地点：X`、`地点-X`、`势力：X`、`势力X` 各种写法都出现过。之前只认带冒号的
 * `地点：`/`势力详情：`，结果一整批「势力」条目被漏掉，底图上没有这些宗门。
 */
const LOCATION_COMMENT = /^(地点|势力|秘境详情|妖族势力|设施[-—]|区域[-—])/;
const LOCATION_CONTENT = /(驻地\s*[:：]|位置\s*[:：]|相对距离\s*[:：]|空间距离\s*[:：]|距[^，。；]{1,12}[0-9０-９]+\s*亿里)/;
/** 仙界相关条目：当前剧情舞台是玄天界，整套跳过 */
const IMMORTAL_ENTRY = /(仙界|仙域|天庭|瑶池|凌霄|界碑关)/;
/** 世界骨架档固定要取的条目名 */
const WORLD_SKELETON_NAMES = ['玄天界介绍', '玄天界周期性秘境', '秘境详情：蓬莱仙岛'];
/** 剥掉 `[MOD][xxx]` 之类的前缀，拿到真正的条目名 */
export function entryTitle(comment) {
    return comment.replace(/^\[MOD\](\[[^\]]*\]){0,4}/, '').trim();
}
export function isLocationEntry(comment, content) {
    const name = entryTitle(comment);
    if (IMMORTAL_ENTRY.test(name))
        return false;
    if (LOCATION_COMMENT.test(name))
        return true;
    if (comment.startsWith('[MOD]') && /(地点|设施|区域|坊|宫|城|宗|谷|岛)/.test(name))
        return true;
    return LOCATION_CONTENT.test(content) && content.length > 60;
}
/** 读当前聊天挂着的所有世界书（角色主书 + 扩展书 + 全局书） */
export async function collectLocationEntries() {
    const names = new Set();
    try {
        const charBooks = getCharWorldbookNames('current');
        if (charBooks?.primary)
            names.add(charBooks.primary);
        for (const name of charBooks?.additional ?? [])
            names.add(name);
    }
    catch (error) {
        window.console.warn('[世界舆图] 读取角色世界书名失败', error);
    }
    try {
        for (const name of getGlobalWorldbookNames())
            names.add(name);
    }
    catch (error) {
        window.console.warn('[世界舆图] 读取全局世界书名失败', error);
    }
    const entries = [];
    let total = 0;
    for (const book of names) {
        try {
            const list = (await getWorldbook(book));
            total += list.length;
            for (const raw of list) {
                // 注意：JSR 的 WorldbookEntry 用的是 `name`（不是原始 JSON 里的 `comment`），
                // 关键字在 `strategy.keys`（不是 `key`）。这里两种形状都兼容。
                const entry = raw;
                const comment = String(entry?.name ?? entry?.comment ?? '');
                const content = String(entry?.content ?? '');
                if (!content.trim())
                    continue;
                if (!isLocationEntry(comment, content))
                    continue;
                const keys = Array.isArray(entry?.strategy?.keys)
                    ? entry.strategy.keys.map(String)
                    : Array.isArray(entry?.key)
                        ? entry.key.map(String)
                        : [];
                entries.push({ book, comment, content, keys });
            }
        }
        catch (error) {
            window.console.warn(`[世界舆图] 读取世界书「${book}」失败`, error);
        }
    }
    entries.sort((a, b) => a.comment.localeCompare(b.comment, 'zh'));
    window.console.info(`[世界舆图] 世界书 ${names.size} 本 / 条目 ${total} 条 / 命中地点类 ${entries.length} 条`);
    return { entries, books: [...names], total };
}
/** 按批次挡位挑选条目 */
export function selectEntries(entries, scope, focusPath) {
    if (scope === 'all')
        return entries;
    if (scope === 'world') {
        return entries.filter(entry => {
            const name = entryTitle(entry.comment);
            if (WORLD_SKELETON_NAMES.some(fixed => name === fixed || name.endsWith(fixed)))
                return true;
            // 「地点」和「势力」开头的全都要 —— 只收地点会把所有宗门/门派漏掉
            return /^(地点|势力)/.test(name);
        });
    }
    // region：挑与该路径有关联的条目
    const focusSegments = (focusPath ?? '').split('·').filter(Boolean);
    const focusName = focusSegments[focusSegments.length - 1] ?? '';
    return entries.filter(entry => {
        const name = entryTitle(entry.comment);
        if (focusName && (name.includes(focusName) || entry.content.includes(focusName)))
            return true;
        return focusSegments.some(segment => segment.length >= 2 && entry.content.includes(segment));
    });
}
const SYSTEM_PROMPT = `你是一个修仙世界的地理测绘助手。你要把给定的世界观资料整理成**十字坐标轴上的节点**，输出严格 JSON。

【只画玄天界】
- 本次只测绘「玄天界」。资料里凡属于**仙界/仙域/天庭/瑶池/凌霄**的内容一律**不要**输出。
- 玄天界 = 中央神州居中，四方为东极青木域、南离火洲、西漠佛国、北冥雪原。

【坐标系：神都洛阳就是原点】
- **中央神州·大周仙朝·神都洛阳 = (0,0)** —— 它是整个坐标系的原点，也是一切距离换算的基准。
- 画布是 **-500..500 的有符号坐标**：正东 +x、正南 +y，**向西 / 向北为负**。
  例：北冥雪原在正北 → y 是负的；西漠佛国在正西 → x 是负的。
- 换算比例：**1 单位 = 15 亿里**。资料写「距神都 700 亿里、向西」就换算成 x = -700/15 ≈ -47。
- 固定锚点（直接采用，不要改）：
  神都(0,0)、东极青木域(200,0)、西漠佛国(-200,0)、南离火洲(0,200)、北冥雪原(0,-200)；
  中央神州四条边界：无尽山脉(100,0)、叹息沙海(-100,0)、烬骨荒原(0,100)、绝迹冰谷(0,-100)。
- **所有坐标都围着神都铺开**：先钉死神都在 (0,0)，再按方位/距离把其余地点摆到它四周，
  不要出现整张图偏离原点、或者把神都挪到别处的情况。
- 只有方位没有距离时，按方位给合理偏移（东南方就 x+40、y+40 之类），宁可粗略也不要留空。
- 同一父级下的兄弟节点必须彼此分开，不要重叠。

【第一件事：把该有的都找齐，一个都不能漏】
- 资料里**每一条以「地点」「势力」开头的条目，都必须产出一个节点**。有 20 条就出 20 个，
  不许因为「不好定位」就跳过。同一个地方在两条资料里重复出现的，合并成一个。
- 输出前自己核对一遍：条目数 ≈ 节点数。

【第二件事：坐标要有依据，不许编】
- 先把**所有条目正文**里的方位、距离、相邻关系（「在X东北约300亿里」「紧邻Y」「位于Z腹地」）找出来，
  让不同条目**相互印证**：A 条说它在神都以东、B 条说它挨着沂云森林，就结合两条一起定坐标。
- 只有一处资料提到它时，用那处给出的「相对某个已知地点的方向+距离」推算。
- 完全没有任何方位线索时，挂到最合理的上级节点附近，并在 note 里写明「资料未给方位，按上级估算」。
- **禁止为了凑数随手编坐标**。宁可贴着上级放，也不要凭空给一个看起来精确的数。

【第三件事：分清楚「省」和「市」—— 这里最容易画错】
资料里这两类的体量差着两个数量级，**绝不能都画成一样大的点**：

1) 大区（相当于「省」）：\`*州\`、\`*域\`、\`*国\`、\`*洲\`、\`*原\`、\`*界\` 这类横跨几千亿里的整体。
   - kind 用 region；只有最上层的玄天界用 realm。
   - **它是一片范围，不是一个点**：除 x/y（填范围中心）外，还要给 \`shape\` —— 沿资料描述的实际走向，
     用 4~8 个顶点把这片地方的边界围出来。顶点用同一套有符号坐标，首尾不用重复，形状大体符合资料里的长宽。
     例：东极青木域东西 3800 亿里（≈253 单位）、南北 4500 亿里（≈300 单位），中心在 (200,0)，
     shape 可以是 [[200,-150],[330,-80],[335,90],[200,150],[75,90],[70,-80]]。
2) 点（相当于「市」）：\`*宗\`、\`*门\`、\`*派\`、\`*谷\`、\`*林\`、\`*沼\`、\`*宫\`、\`*殿\`、\`*城\`、\`*坊\`、\`*塔\`、\`*岛\`。
   - 势力 / 宗门 / 门派 / 家族 → kind 用 city（宗级势力一律按市级处理）。
   - 单个地理点（秘境、岛屿、塔、遗址）→ kind 用 site。
   - 这些**只给 x/y，不要给 shape**，它们就是一个点。
- 判断口径：**某个「宗」一定在某个「州」的内部**。同一批里如果两个节点体量明显一大一小，
  大的那个就该是带 shape 的 region，小的那个是 city/site；不要让「州」和「宗」变成同一级的两个点。

【绝对不要做成节点的东西】
- **纯方位词**：东部/南部/西部/北部/东南部/西南部/东北部/西北部/极东/极西/中部/中域腹地/腹地 —— 这些只表示方向，
  **不要把方位词单独输出成一个节点**，也不要用它当父路径的中间层。例如「中央神州·西部·蜀山剑门」要输出成
  「中央神州·蜀山剑门」，位置按「向西 700 亿里」算即可。
- 环境描述（含「的」「半垂」「明灭」这类描写的短句）。
- 零碎设施：马厩、柴房、水井、后院、某某客房、某某铺子、某家门口。**不要输出 room 这一级**，
  它们只会把地图糊成一团。
- 重复地点：同一个地方只输出一次，用资料里最完整的那个名字。

【输出格式】只输出这个 JSON，不要解释、不要代码块围栏：
{"nodes":[
{"path":"中央神州·大周仙朝·神都","x":0,"y":0,"kind":"city","note":"资料：玄天界中心，坐标系原点"},
{"path":"东极青木域","x":200,"y":0,"kind":"region","shape":[[200,-150],[330,-80],[335,90],[200,150],[75,90],[70,-80]],"note":"资料：最东方，东西3800亿里、南北4500亿里"}
],"edges":[{"from":"中央神州","to":"东极青木域","kind":"边界"}]}
path 用「·」连接、从大到小；不要出现方位词层。shape 只给 realm / region，其他一律不给。
再强调一次：神都洛阳必须是 (0,0)，向西 / 向北的坐标是负数。`;
/** 宽容地读 shape：只接受 [x,y] 数组，至少 3 个点，坐标落在画布内 */
function sanitizeShape(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const points = [];
    for (const item of raw) {
        if (!Array.isArray(item) || item.length < 2)
            continue;
        const x = Number(item[0]);
        const y = Number(item[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            continue;
        if (x < COORD_MIN - 50 || x > COORD_MAX + 50 || y < COORD_MIN - 50 || y > COORD_MAX + 50)
            continue;
        points.push([x, y]);
    }
    return points.length >= 3 ? points : undefined;
}
/** 允许 AI 输出的层级：界域/地域/城池/势力/具体地点（不要 room，会糊成一团） */
const ALLOWED_AI_KINDS = ['realm', 'region', 'city', 'power', 'site'];
export function buildLayoutPrompt(entries, options) {
    const budget = options.budget ?? 24000;
    const scopeLabel = options.scope === 'world' ? '世界骨架（大域/大势力/主要城池）' : options.scope === 'region' ? `区域细分：${options.focusPath ?? ''}` : '全部地点';
    const header = `任务：绘制【${scopeLabel}】。\n\n已知节点（不要改动它们的坐标，只补充新节点）：\n`;
    const known = options.existing
        .filter(node => node.depth <= 3)
        .slice(0, 120)
        .map(node => `${node.path} (${node.xy[0]},${node.xy[1]})`)
        .join('\n');
    let used = 0;
    const chunks = [];
    for (const entry of entries) {
        const body = entry.content.length > 1200 ? entry.content.slice(0, 1200) + '…' : entry.content;
        const chunk = `\n### ${entry.comment}\n${body}\n`;
        if (used + chunk.length > budget)
            break;
        used += chunk.length;
        chunks.push(chunk);
    }
    const user = `${header}${known}\n\n世界观资料：\n${chunks.join('')}\n\n请输出 JSON。`;
    return { system: SYSTEM_PROMPT, user, used, total: entries.length };
}
/** 宽容解析：剥围栏 → 直接 parse → 修复后再 parse */
export function parseLayoutReply(text) {
    const candidates = [];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced)
        candidates.push(fenced[1]);
    candidates.push(text);
    const firstBrace = text.indexOf('{');
    if (firstBrace >= 0)
        candidates.push(text.slice(firstBrace));
    for (const candidate of candidates) {
        const body = candidate.trim();
        for (const attempt of [body, repairJsonLoose(body)]) {
            try {
                const parsed = JSON.parse(attempt);
                const nodes = Array.isArray(parsed) ? parsed : parsed?.nodes;
                if (!Array.isArray(nodes))
                    continue;
                const result = [];
                for (const node of nodes) {
                    const path = String(node?.path ?? '').trim();
                    const x = Number(node?.x ?? node?.xy?.[0]);
                    const y = Number(node?.y ?? node?.xy?.[1]);
                    if (!path || !Number.isFinite(x) || !Number.isFinite(y))
                        continue;
                    result.push({ path, x, y, kind: node?.kind, shape: sanitizeShape(node?.shape), note: node?.note });
                }
                if (result.length)
                    return result;
            }
            catch {
                /* 试下一种 */
            }
        }
    }
    return [];
}
function repairJsonLoose(text) {
    let body = text.trim();
    const start = body.indexOf('{');
    if (start > 0)
        body = body.slice(start);
    const lastBrace = body.lastIndexOf('}');
    if (lastBrace >= 0)
        body = body.slice(0, lastBrace + 1);
    return body.replace(/,\s*([\]}])/g, '$1');
}
/** 把 AI 给的节点合并进图（就地修改 graph） */
export function mergeAiLayout(graph, nodes) {
    const result = { added: 0, moved: 0, skippedLocked: 0, skippedBad: 0, skippedTrivial: 0, conflicts: [] };
    const sorted = [...nodes].sort((a, b) => a.path.split('·').length - b.path.split('·').length);
    for (const item of sorted) {
        const x = Number(item.x);
        const y = Number(item.y);
        if (!Number.isFinite(x) ||
            !Number.isFinite(y) ||
            x < COORD_MIN - 50 ||
            x > COORD_MAX + 50 ||
            y < COORD_MIN - 50 ||
            y > COORD_MAX + 50) {
            result.skippedBad++;
            continue;
        }
        const segments = item.path
            .split('·')
            .map(part => part.trim())
            .filter(Boolean)
            // 方位词不做节点：即使模型没听话，这里也把它剥掉
            .filter(segment => !isBearingSegment(segment));
        if (!segments.length || segments.some(looksLikeDescription)) {
            result.skippedBad++;
            continue;
        }
        // 只接受界域/地域/城池/势力/具体地点；零碎设施（room 那一级）一律丢弃
        const kind = item.kind;
        if (kind && !ALLOWED_AI_KINDS.includes(kind)) {
            result.skippedTrivial++;
            continue;
        }
        if (segments.some(segment => isTrivialFacility(segment))) {
            result.skippedTrivial++;
            continue;
        }
        const resolved = graph.resolve(segments.join('·'), { create: true, source: 'ai' });
        if (!resolved) {
            result.skippedBad++;
            continue;
        }
        const node = resolved.node;
        if (node.locked || node.source === 'manual') {
            const moved = Math.abs(node.xy[0] - x) > 1 || Math.abs(node.xy[1] - y) > 1;
            if (moved)
                result.conflicts.push({ path: node.path, kept: node.xy, dropped: [x, y] });
            result.skippedLocked++;
            continue;
        }
        const wasNew = resolved.created;
        node.xy = [x, y];
        node.source = 'ai';
        node.status = 'ok';
        if (item.kind)
            node.kind = item.kind;
        // shape 只对「一片地方」有意义：大区留下，点状节点一律清掉
        const isArea = node.kind === 'realm' || node.kind === 'region';
        node.shape = isArea ? item.shape ?? node.shape : undefined;
        if (item.note)
            node.note = item.note;
        if (wasNew)
            result.added++;
        else
            result.moved++;
    }
    return result;
}
/** 调一次模型（OpenAI 兼容端点，不经过酒馆正文管道） */
export async function requestLayout(settings, prompt) {
    const base = settings.api.url.replace(/\/+$/, '');
    const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(settings.api.key ? { Authorization: `Bearer ${settings.api.key}` } : {}),
        },
        body: JSON.stringify({
            model: settings.api.model,
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
            ],
            temperature: settings.api.temperature,
            max_tokens: settings.api.maxTokens,
            stream: false,
        }),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`模型接口返回 ${response.status}：${body.slice(0, 300)}`);
    }
    const data = (await response.json());
    const choice = data?.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (!text) {
        // 「空回复」几乎都是输出被 max_tokens 掐掉了：有的服务端这时 content 直接是空串，
        // 有的会把已生成的一半塞进 content、finish_reason 是 length。两种都要说清楚。
        const limit = settings.api.maxTokens;
        const used = data?.usage?.completion_tokens;
        if (choice?.finish_reason === 'length') {
            throw new Error(`模型输出被「上限」截断（上限 ${limit}${used ? `，已用 ${used}` : ''}）。` +
                `资料太多时模型要吐很长的 JSON，把设置里的「上限」调大到 16384 以上再试。`);
        }
        if (choice?.message?.reasoning_content) {
            throw new Error(`模型只返回了思考过程、没有返回 JSON（上限 ${limit}）。` +
                `换一个直接输出答案的模型（名称里带 nothinking / non-thinking 的），或把上限调大。`);
        }
        throw new Error(`模型返回为空（上限 ${limit}）。常见原因：上限太小被截断、模型不支持该端点、或服务端把回复放进了别的字段。` +
            `把「上限」调到 16384 以上再试；仍为空就换个模型。`);
    }
    if (choice?.finish_reason === 'length') {
        // 有内容但被截断：多半解析不出完整 JSON，提前给出可操作的提示
        window.console.warn(`[世界舆图] 模型输出被上限截断（${settings.api.maxTokens}），可能解析失败`);
    }
    return { text, usage: data.usage };
}
/** 一次性走完：收集 → 挑选 → 请求 → 合并 */
export async function runLayout(graph, settings, scope, focusPath, onProgress) {
    onProgress?.('正在读取世界书…');
    const { entries, books, total } = await collectLocationEntries();
    if (!entries.length) {
        throw new Error(`没有读到任何地点类世界书条目（共检查 ${books.length} 本世界书 / ${total} 条条目：` +
            `${books.join('、') || '没读到书名'}）。请确认当前角色卡绑定了世界书。`);
    }
    const picked = selectEntries(entries, scope, focusPath);
    if (!picked.length) {
        throw new Error(`世界书里读到了 ${entries.length} 条地点类条目，但这一档（${scope === 'world' ? '世界骨架' : scope === 'region' ? '当前区域' : '全部'}）没筛出可用的。` +
            `换个档位试试，或先用「全部地点」。`);
    }
    const prompt = buildLayoutPrompt(picked, { scope, focusPath, existing: graph.toArray() });
    onProgress?.(`已选 ${prompt.total} 条资料（约 ${Math.round(prompt.used / 1000)}k 字符），正在请求模型…`);
    const { text } = await requestLayout(settings, prompt);
    const nodes = parseLayoutReply(text);
    if (!nodes.length)
        throw new Error('模型返回的内容无法解析出任何节点，已放弃本次生成');
    onProgress?.(`模型返回 ${nodes.length} 个节点，正在合并…`);
    const result = mergeAiLayout(graph, nodes);
    return { result, used: prompt.used, total: prompt.total, picked, rawReply: text };
}
export function graphToBaseMapPatch(graph, base) {
    base.nodes = graph.toArray();
    base.updatedAt = new Date().toISOString();
    return base;
}
//# sourceMappingURL=layout-ai.js.map