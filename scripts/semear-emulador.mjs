// Cria contas de teste JA APROVADAS no emulador local (nunca no banco real), para
// abrir http://localhost:5000 e testar cada perfil.
//
// Uso, com os emuladores rodando (npx firebase-tools@13 emulators:start):
//   node scripts/semear-emulador.mjs
//
// Senha de todas as contas de teste: teste123 (so existe no emulador).
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const SENHA = 'teste123';
const UNIDADE = 'Penitenciária de Florianópolis';
const contas = [
  { email: 'dpp@teste.local', nome: 'Teste DPP', perfil: 'DPP', sr: null, unidade: null, cargo: null },
  { email: 'sr01@teste.local', nome: 'Teste SR01', perfil: 'SR', sr: 'SR01', unidade: null, cargo: null },
  { email: 'diretor@teste.local', nome: 'Teste Diretor(a)', perfil: 'DIR', sr: 'SR01', unidade: UNIDADE, cargo: null },
  { email: 'psicologa@teste.local', nome: 'Teste Psicóloga', perfil: 'MEMBRO', sr: 'SR01', unidade: UNIDADE, cargo: 'psicologo' },
  { email: 'social@teste.local', nome: 'Teste Assistente Social', perfil: 'MEMBRO', sr: 'SR01', unidade: UNIDADE, cargo: 'assistente_social' },
];

const env = await initializeTestEnvironment({ projectId: 'ctc-sc', firestore: { host: '127.0.0.1', port: 8080 } });

for (const c of contas) {
  const resp = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulador', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: SENHA, returnSecureToken: true }),
  });
  const r = await resp.json();
  if (!r.localId) { console.log('pulei ' + c.email + ': ' + (r.error && r.error.message)); continue; }
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'usuarios', r.localId), {
    nome: c.nome, matricula: '0000', email: c.email, perfilSolicitado: c.perfil, perfil: c.perfil,
    cargo: c.cargo, unidade: c.unidade, sr: c.sr, status: 'ATIVO', criadoEm: new Date(),
  }));
  console.log('criada ' + c.email + ' (' + c.perfil + ')');
}
await env.cleanup();
