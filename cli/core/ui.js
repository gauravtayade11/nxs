import chalk from 'chalk';

export const VERSION = '2.0.0';

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
  if (Array.isArray(val))     return val.map((v, i) => `${i + 1}. ${v}`).join('\n');
  if (val && typeof val === 'object') return Object.entries(val).map(([k, v]) => `${k}: ${v}`).join('\n');
  return String(val ?? '');
}

export function printResult(result) {
  const color = TOOL_COLORS[result.tool] ?? chalk.white;
  const icon  = TOOL_ICONS[result.tool]  ?? '⚙  ';

  console.log('\n' + hr());
  console.log(color.bold(`  ${icon}${(result.tool ?? 'unknown').toUpperCase()} DETECTED`));
  console.log(hr());

  console.log(`\n${chalk.dim('📋')} ${chalk.bold('SUMMARY')}\n`);
  console.log(chalk.white('  ' + toStr(result.summary).replace(/\n/g, '\n  ')));

  console.log(`\n${chalk.dim('🔍')} ${chalk.bold('ROOT CAUSE')}\n`);
  toStr(result.rootCause).split('\n').forEach((l) => console.log(chalk.hex('#94a3b8')('  ' + l)));

  console.log(`\n${chalk.dim('💡')} ${chalk.bold('FIX STEPS')}\n`);
  toStr(result.fixSteps).split('\n').forEach((l) =>
    console.log(l.startsWith('-')
      ? chalk.green('  ✓') + chalk.white(l.slice(1))
      : chalk.hex('#94a3b8')('  ' + l))
  );

  console.log(`\n${chalk.dim('💻')} ${chalk.bold('REMEDIATION COMMANDS')}\n`);
  console.log(chalk.dim('  ┌─ shell ─────────────────────────────────┐'));
  toStr(result.commands).split('\n').forEach((c) =>
    console.log(chalk.dim('  │ ') + chalk.hex('#00e5ff')(c.padEnd(42)) + chalk.dim('│'))
  );
  console.log(chalk.dim('  └─────────────────────────────────────────┘'));
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
