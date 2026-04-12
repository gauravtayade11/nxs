import chalk from 'chalk';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
export const VERSION = _require('../../package.json').version;

export function hr(len = 60) { return chalk.dim('─'.repeat(len)); }

export function providerInfo() {
  if (process.env.GROQ_API_KEY)      return { label: ' GROQ ',   badge: chalk.bgGreen.black,   name: 'Groq — Llama 3.3 70b' };
  if (process.env.ANTHROPIC_API_KEY) return { label: ' CLAUDE ', badge: chalk.bgMagenta.black, name: 'Anthropic — claude-opus-4-6' };
  return { label: ' DEMO ', badge: chalk.bgHex('#334155').white, name: 'Demo mode — mock responses' };
}

export function printBanner(subtitle = 'Multi-tool DevOps & Cloud debugger') {
  const p = providerInfo();
  console.log('\n' + chalk.dim('╔' + '═'.repeat(58) + '╗'));
  console.log(chalk.dim('║') + ' '.repeat(58) + chalk.dim('║'));
  console.log(chalk.dim('║') + chalk.bold.cyan('  ⚡ nxs') + chalk.dim(`                                        v${VERSION}  `) + chalk.dim('║'));
  console.log(chalk.dim('║') + chalk.hex('#94a3b8')(`     ${subtitle}`) + chalk.dim(' '.repeat(Math.max(0, 53 - subtitle.length))) + chalk.dim('║'));
  console.log(chalk.dim('║') + ' '.repeat(58) + chalk.dim('║'));
  console.log(chalk.dim('╚' + '═'.repeat(58) + '╝'));
  console.log(`\n  ${p.badge(p.label)}  ${chalk.dim(p.name)}\n`);
}

export const TOOL_COLORS = {
  kubernetes: chalk.blue,
  docker:     chalk.cyan,
  terraform:  chalk.magenta,
  ci:         chalk.yellow,
  aws:        chalk.hex('#FF9900'),
  gcp:        chalk.hex('#4285F4'),
  azure:      chalk.hex('#0078D4'),
  unknown:    chalk.gray,
};

export const TOOL_ICONS = {
  kubernetes: '☸  ',
  docker:     '🐳 ',
  terraform:  '🏗  ',
  ci:         '🔄 ',
  aws:        '☁  ',
  gcp:        '🌐 ',
  azure:      '🔷 ',
  unknown:    '⚙  ',
};

// Normalize a field that the AI may return as string, array, or object
function toStr(val) {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    // Filter out bare numbers (AI sometimes returns [0, "step", 0, "step"])
    const items = val.filter((v) => v !== null && v !== undefined && typeof v !== 'number' && String(v).trim() !== '');
    return items.map((v, i) => {
      if (Array.isArray(v)) return `${i + 1}. ${toStr(v)}`;
      if (v && typeof v === 'object') return `${i + 1}. ${Object.values(v).join(' ')}`;
      return `${i + 1}. ${v}`;
    }).join('\n');
  }
  if (val && typeof val === 'object') return Object.entries(val).map(([k, v]) => `${k}: ${v}`).join('\n');
  return String(val ?? '');
}

function renderConfidence(confidence) {
  if (confidence == null) return;
  const n    = Math.max(0, Math.min(100, Math.round(confidence)));
  const bars = Math.round(n / 5); // 0-20 filled blocks
  const filled = chalk.cyan('█'.repeat(bars));
  const empty  = chalk.dim('░'.repeat(20 - bars));
  const color  = n >= 85 ? chalk.green.bold : n >= 65 ? chalk.yellow : chalk.red;
  console.log(`  ${chalk.dim('Confidence:')} ${filled}${empty} ${color(`${n}%`)}`);
}

function renderVia(via) {
  if (!via) return;
  const badges = {
    'rules':         chalk.bgCyan.black(' RULES ENGINE '),
    'ai-groq':       chalk.bgGreen.black(' AI · GROQ '),
    'ai-anthropic':  chalk.bgMagenta.black(' AI · CLAUDE '),
    'mock':          chalk.bgHex('#334155').white(' DEMO '),
  };
  const badge = badges[via] ?? chalk.bgHex('#334155').white(` ${via.toUpperCase()} `);
  console.log(`  ${badge}`);
}

export function printResult(result, freq = null) {
  const color = TOOL_COLORS[result.tool] ?? chalk.white;
  const icon  = TOOL_ICONS[result.tool]  ?? '⚙  ';

  // Show mock/fallback warning banners
  if (result._mock) {
    console.log(chalk.yellow('\n  ⚠  DEMO MODE — no API key set. Add GROQ_API_KEY for real AI analysis.'));
    console.log(chalk.dim('     Run: nxs config --setup\n'));
  } else if (result._warning) {
    console.log(chalk.yellow(`\n  ⚠  ${result._warning}`));
    console.log(chalk.dim('     Showing approximate response.\n'));
  }
  if (result._truncated) {
    console.log(chalk.dim('  ↳ Input truncated to 8000 chars (Groq free tier limit)\n'));
  }

  console.log('\n' + hr());
  console.log(color.bold(`  ${icon}${(result.tool ?? 'unknown').toUpperCase()} DETECTED`));
  // Via badge + confidence bar on same row block
  console.log('');
  renderVia(result.via);
  renderConfidence(result.confidence);
  console.log(hr());

  console.log(`\n${chalk.dim('📋')} ${chalk.bold('SUMMARY')}\n`);
  console.log(chalk.white('  ' + toStr(result.summary).replace(/\n/g, '\n  ')));

  if (result.impact) {
    console.log(`\n${chalk.dim('⚡')} ${chalk.bold('IMPACT')}\n`);
    toStr(result.impact).split('\n').forEach((l) => console.log(chalk.hex('#fbbf24')('  ' + l)));
  }

  console.log(`\n${chalk.dim('🔍')} ${chalk.bold('ROOT CAUSE')}\n`);
  toStr(result.rootCause).split('\n').forEach((l) => console.log(chalk.hex('#94a3b8')('  ' + l)));

  console.log(`\n${chalk.dim('💡')} ${chalk.bold('FIX STEPS')}\n`);
  toStr(result.fixSteps).split('\n').forEach((l) =>
    console.log(l.startsWith('-')
      ? chalk.green('  ✓') + chalk.white(l.slice(1))
      : chalk.hex('#94a3b8')('  ' + l))
  );

  console.log(`\n${chalk.dim('💻')} ${chalk.bold('REMEDIATION COMMANDS')}\n`);
  const cmds = toStr(result.commands).split('\n').filter(Boolean);
  const boxW = Math.min(Math.max(...cmds.map((c) => c.length), 40) + 2, 100);
  console.log(chalk.dim('  ┌─ shell ' + '─'.repeat(boxW - 8) + '┐'));
  cmds.forEach((c) =>
    console.log(chalk.dim('  │ ') + chalk.hex('#00e5ff')(c.padEnd(boxW - 1)) + chalk.dim('│'))
  );
  console.log(chalk.dim('  └' + '─'.repeat(boxW + 1) + '┘'));

  // Suggestions (proactive improvements)
  if (result.suggestions?.length > 0) {
    console.log(`\n${chalk.dim('🚀')} ${chalk.bold('SUGGESTIONS')}\n`);
    const suggestions = Array.isArray(result.suggestions)
      ? result.suggestions
      : String(result.suggestions).split('\n').filter(Boolean);
    suggestions.forEach((s) => {
      console.log(`  ${chalk.cyan('›')} ${chalk.hex('#94a3b8')(String(s).replace(/^[-•]\s*/, ''))}`);
    });
  }

  // Pattern frequency
  if (freq && freq.count > 1) {
    console.log('');
    console.log(
      `  ${chalk.bgYellow.black(` ⚑ PATTERN `)}  ${chalk.yellow.bold(`Seen ${freq.count}× in the last ${freq.days} days`)}  ` +
      chalk.dim(`Last: ${new Date(freq.lastSeen).toLocaleString()}`)
    );
  }

  console.log('\n' + hr() + '\n');
}

export function prompt(rl, q) {
  return new Promise((res) => rl.question(q, res));
}

export async function readStdin() {
  return new Promise((res) => {
    let d = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => res(d));
  });
}
