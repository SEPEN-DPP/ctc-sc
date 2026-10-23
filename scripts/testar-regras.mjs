// Testes do firestore.rules no emulador local (nunca no banco real).
//
// Uso, na pasta do projeto:
//   npx firebase-tools@13 emulators:exec --only firestore "node scripts/testar-regras.mjs"
//
// Cada caso grava como o index.html grava (registro + historico no mesmo lote) e
// confere se a regra aceita ou recusa.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'ctc-sc-teste',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});

const A = { unidade: 'Penitenciária de Florianópolis', sr: 'SR01' };
const B = { unidade: 'Penitenciária Sul', sr: 'SR02' };
const contas = {
  dpp: { perfil: 'DPP', status: 'ATIVO', unidade: null, sr: null, cargo: null },
  sr1: { perfil: 'SR', status: 'ATIVO', unidade: null, sr: 'SR01', cargo: null },
  sr2: { perfil: 'SR', status: 'ATIVO', unidade: null, sr: 'SR02', cargo: null },
  dirA: { perfil: 'DIR', status: 'ATIVO', ...A, cargo: null },
  psiA: { perfil: 'MEMBRO', status: 'ATIVO', ...A, cargo: 'psicologo' },
  socA: { perfil: 'MEMBRO', status: 'ATIVO', ...A, cargo: 'assistente_social' },
  chefeA: { perfil: 'MEMBRO', status: 'ATIVO', ...A, cargo: 'chefe_de_servico' },
  psiB: { perfil: 'MEMBRO', status: 'ATIVO', ...B, cargo: 'psicologo' },
  suspA: { perfil: 'MEMBRO', status: 'SUSPENSO', ...A, cargo: 'psicologo' },
  pendMembroA: { perfil: null, perfilSolicitado: 'MEMBRO', status: 'PENDENTE', ...A, cargo: 'psicologo' },
  pendDirA: { perfil: null, perfilSolicitado: 'DIR', status: 'PENDENTE', ...A, cargo: null },
  pendSr1: { perfil: null, perfilSolicitado: 'SR', status: 'PENDENTE', unidade: null, sr: 'SR01', cargo: null },
  pendLeituraA: { perfil: null, perfilSolicitado: 'MEMBRO', status: 'PENDENTE', ...A, cargo: 'psicologo' },
};

let falhas = 0;
let total = 0;
async function caso(descricao, promessa) {
  total += 1;
  try { await promessa; console.log('  ok  ' + descricao); }
  catch (e) { falhas += 1; console.log('  FALHOU  ' + descricao + '\n          ' + (e.message || e).split('\n')[0]); }
}
const aceita = (p) => assertSucceeds(p);
const recusa = (p) => assertFails(p);

function bd(uid) {
  return uid ? env.authenticatedContext(uid, { email: uid + '@exemplo.gov.br' }).firestore() : env.unauthenticatedContext().firestore();
}

// Grava como o index.html (gravarVarios): registro + historico no mesmo lote.
// itens: [{ col, id, dados, rev, unidade?, sr?, novo? }]
function gravar(uid, itens) {
  const db = bd(uid);
  const lote = writeBatch(db);
  for (const it of itens) {
    const rev = it.rev || 1;
    const meta = { id: it.id, rev, updatedBy: uid, updatedByNome: uid, updatedAt: serverTimestamp() };
    if (rev === 1) {
      lote.set(doc(db, it.col, it.id), { ...it.dados, ...meta, unidade: it.unidade ?? A.unidade, sr: it.sr ?? A.sr, createdBy: uid, createdAt: serverTimestamp() });
    } else {
      lote.set(doc(db, it.col, it.id), { ...it.dados, ...meta }, { merge: true });
    }
    if (!it.semHistorico) {
      lote.set(doc(db, it.col, it.id, 'historico', String(rev)), { rev, acao: 'teste', autor: uid, autorNome: uid, em: serverTimestamp(), dados: it.dados });
    }
  }
  return lote.commit();
}

async function semearContas() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, c] of Object.entries(contas)) {
      await setDoc(doc(db, 'usuarios', uid), {
        nome: uid, matricula: '1', email: uid + '@exemplo.gov.br',
        perfilSolicitado: c.perfilSolicitado || c.perfil, ...c, criadoEm: new Date(),
      });
    }
  });
}

await semearContas();

console.log('\nCadastro e aprovação de contas');
const cadastro = (extra) => ({
  nome: 'Nova Pessoa', matricula: '123', email: 'novo@exemplo.gov.br', perfilSolicitado: 'MEMBRO', perfil: null,
  cargo: 'psicologo', unidade: A.unidade, sr: 'SR01', status: 'PENDENTE', criadoEm: serverTimestamp(), ...extra,
});
await caso('autocadastro PENDENTE de membro é aceito', aceita(setDoc(doc(bd('novo'), 'usuarios', 'novo'), cadastro())));
await caso('autocadastro já ATIVO é recusado', recusa(setDoc(doc(bd('novo2'), 'usuarios', 'novo2'), cadastro({ email: 'novo2@exemplo.gov.br', status: 'ATIVO' }))));
await caso('autocadastro com perfil já preenchido é recusado', recusa(setDoc(doc(bd('novo3'), 'usuarios', 'novo3'), cadastro({ email: 'novo3@exemplo.gov.br', perfil: 'DPP' }))));
await caso('autocadastro com e-mail de outra pessoa é recusado', recusa(setDoc(doc(bd('novo4'), 'usuarios', 'novo4'), cadastro({ email: 'outra@exemplo.gov.br' }))));
await caso('autocadastro de membro sem cargo é recusado', recusa(setDoc(doc(bd('novo5'), 'usuarios', 'novo5'), cadastro({ email: 'novo5@exemplo.gov.br', cargo: null }))));
await caso('criar cadastro em nome de outra conta é recusado', recusa(setDoc(doc(bd('novo6'), 'usuarios', 'outro'), cadastro({ email: 'novo6@exemplo.gov.br' }))));

const aprovar = (perfil) => ({ perfil, status: 'ATIVO', atualizadoPor: '', atualizadoEm: serverTimestamp() });
await caso('membro não aprova conta', recusa(updateDoc(doc(bd('psiA'), 'usuarios', 'pendMembroA'), { ...aprovar('MEMBRO'), atualizadoPor: 'psiA' })));
await caso('diretor(a) não aprova outro diretor(a)', recusa(updateDoc(doc(bd('dirA'), 'usuarios', 'pendDirA'), { ...aprovar('DIR'), atualizadoPor: 'dirA' })));
await caso('diretor(a) não aprova com perfil diferente do pedido', recusa(updateDoc(doc(bd('dirA'), 'usuarios', 'pendMembroA'), { ...aprovar('DIR'), atualizadoPor: 'dirA' })));
await caso('diretor(a) não muda a unidade ao aprovar', recusa(updateDoc(doc(bd('dirA'), 'usuarios', 'pendMembroA'), { ...aprovar('MEMBRO'), atualizadoPor: 'dirA', unidade: B.unidade })));
await caso('SR de outra regional não aprova', recusa(updateDoc(doc(bd('sr2'), 'usuarios', 'pendMembroA'), { ...aprovar('MEMBRO'), atualizadoPor: 'sr2' })));
await caso('SR não aprova conta de SR', recusa(updateDoc(doc(bd('sr1'), 'usuarios', 'pendSr1'), { ...aprovar('SR'), atualizadoPor: 'sr1' })));
await caso('diretor(a) aprova membro da própria unidade', aceita(updateDoc(doc(bd('dirA'), 'usuarios', 'pendMembroA'), { ...aprovar('MEMBRO'), atualizadoPor: 'dirA' })));
await caso('SR aprova diretor(a) da regional', aceita(updateDoc(doc(bd('sr1'), 'usuarios', 'pendDirA'), { ...aprovar('DIR'), atualizadoPor: 'sr1' })));
await caso('DPP aprova SR', aceita(updateDoc(doc(bd('dpp'), 'usuarios', 'pendSr1'), { ...aprovar('SR'), atualizadoPor: 'dpp' })));
await caso('diretor(a) suspende membro da unidade', aceita(updateDoc(doc(bd('dirA'), 'usuarios', 'pendMembroA'), { status: 'SUSPENSO', atualizadoPor: 'dirA', atualizadoEm: serverTimestamp() })));
await caso('DPP não altera a própria conta', recusa(updateDoc(doc(bd('dpp'), 'usuarios', 'dpp'), { perfil: 'DPP', status: 'ATIVO' })));
await caso('membro lê a própria conta', aceita(getDoc(doc(bd('psiA'), 'usuarios', 'psiA'))));
await caso('membro não lê a conta de colega', recusa(getDoc(doc(bd('psiA'), 'usuarios', 'socA'))));
await caso('SR lista as contas da regional (com filtro)', aceita(getDocs(query(collection(bd('sr1'), 'usuarios'), where('sr', '==', 'SR01')))));
await caso('SR não lista todas as contas (sem filtro)', recusa(getDocs(collection(bd('sr1'), 'usuarios'))));
await caso('DPP lista todas as contas', aceita(getDocs(collection(bd('dpp'), 'usuarios'))));

console.log('\nPessoas e histórico');
await caso('membro registra pessoa na própria unidade', aceita(gravar('psiA', [{ col: 'pessoas', id: 'p1', dados: { nome: 'Pessoa 1', situacao: 'ativo' } }])));
await caso('gravação sem histórico é recusada', recusa(gravar('psiA', [{ col: 'pessoas', id: 'p2', dados: { nome: 'X' }, semHistorico: true }])));
await caso('membro não registra pessoa em outra unidade', recusa(gravar('psiA', [{ col: 'pessoas', id: 'p3', dados: { nome: 'X' }, ...B }])));
await caso('conta suspensa não grava', recusa(gravar('suspA', [{ col: 'pessoas', id: 'p4', dados: { nome: 'X' } }])));
await caso('pessoa + fase no mesmo lote', aceita(gravar('socA', [
  { col: 'pessoas', id: 'p5', dados: { nome: 'Pessoa 5', situacao: 'ativo' } },
  { col: 'fases', id: 'f5', dados: { pplId: 'p5', fase: 'classificacao_singularizacao' } },
])));
await caso('edição com rev + 1 é aceita', aceita(gravar('socA', [{ col: 'pessoas', id: 'p1', dados: { nome: 'Pessoa 1 (corrigido)' }, rev: 2 }])));
await caso('edição em cima de versão velha (rev repetido) é recusada', recusa(gravar('psiA', [{ col: 'pessoas', id: 'p1', dados: { nome: 'Versão velha' }, rev: 2 }])));
await caso('edição que troca a unidade é recusada', recusa(gravar('psiA', [{ col: 'pessoas', id: 'p1', dados: { nome: 'X', unidade: B.unidade }, rev: 3 }])));
await caso('apagar pessoa é recusado (até para o DPP)', recusa(deleteDoc(doc(bd('dpp'), 'pessoas', 'p1'))));
await caso('editar o histórico é recusado', recusa(setDoc(doc(bd('dpp'), 'pessoas', 'p1', 'historico', '1'), { rev: 1, autor: 'dpp' })));
await caso('histórico avulso (sem gravar o registro) é recusado', recusa(setDoc(doc(bd('psiA'), 'pessoas', 'p1', 'historico', '9'), { rev: 9, acao: 'x', autor: 'psiA', em: serverTimestamp() })));
await caso('fase ligada a pessoa de outra unidade é recusada', recusa(gravar('sr2', [{ col: 'fases', id: 'f9', dados: { pplId: 'p1' }, ...B }])));

console.log('\nLeitura por perfil');
await caso('membro da unidade lê a pessoa', aceita(getDoc(doc(bd('psiA'), 'pessoas', 'p1'))));
await caso('membro de outra unidade não lê', recusa(getDoc(doc(bd('psiB'), 'pessoas', 'p1'))));
await caso('SR da regional lê', aceita(getDoc(doc(bd('sr1'), 'pessoas', 'p1'))));
await caso('SR de outra regional não lê', recusa(getDoc(doc(bd('sr2'), 'pessoas', 'p1'))));
await caso('DPP lê', aceita(getDoc(doc(bd('dpp'), 'pessoas', 'p1'))));
await caso('conta pendente não lê', recusa(getDoc(doc(bd('pendLeituraA'), 'pessoas', 'p1'))));
await caso('sem login não lê', recusa(getDoc(doc(bd(null), 'pessoas', 'p1'))));
await caso('membro consulta a unidade (com filtros)', aceita(getDocs(query(collection(bd('psiA'), 'pessoas'), where('unidade', '==', A.unidade), where('sr', '==', A.sr)))));
await caso('membro não consulta sem filtro', recusa(getDocs(collection(bd('psiA'), 'pessoas'))));
await caso('membro lê o histórico da unidade', aceita(getDoc(doc(bd('psiA'), 'pessoas', 'p1', 'historico', '1'))));
await caso('membro de outra unidade não lê o histórico', recusa(getDoc(doc(bd('psiB'), 'pessoas', 'p1', 'historico', '1'))));

console.log('\nFichas por área');
await caso('psicóloga grava a Ficha 2 (Psicologia)', aceita(gravar('psiA', [{ col: 'fichas', id: 'p1_psicologia', dados: { pplId: 'p1', tipo: 'psicologia', valores: { a: 1 } } }])));
await caso('psicóloga não grava a Ficha 1 (Serviço Social)', recusa(gravar('psiA', [{ col: 'fichas', id: 'p1_servico_social', dados: { pplId: 'p1', tipo: 'servico_social' } }])));
await caso('assistente social grava a Ficha 1', aceita(gravar('socA', [{ col: 'fichas', id: 'p1_servico_social', dados: { pplId: 'p1', tipo: 'servico_social' } }])));
await caso('assistente social não edita a Ficha 2', recusa(gravar('socA', [{ col: 'fichas', id: 'p1_psicologia', dados: { pplId: 'p1', tipo: 'psicologia', valores: { a: 2 } }, rev: 2 }])));
await caso('chefe de serviço não grava ficha técnica', recusa(gravar('chefeA', [{ col: 'fichas', id: 'p1_saude', dados: { pplId: 'p1', tipo: 'saude' } }])));
await caso('diretor(a) não grava ficha técnica', recusa(gravar('dirA', [{ col: 'fichas', id: 'p1_policia_penal', dados: { pplId: 'p1', tipo: 'policia_penal' } }])));
await caso('ficha não pode trocar de tipo', recusa(gravar('psiA', [{ col: 'fichas', id: 'p1_psicologia', dados: { pplId: 'p1', tipo: 'servico_social' }, rev: 2 }])));
await caso('SR grava qualquer ficha da regional', aceita(gravar('sr1', [{ col: 'fichas', id: 'p1_saude', dados: { pplId: 'p1', tipo: 'saude' } }])));
await caso('diretor(a) lê a ficha da unidade', aceita(getDoc(doc(bd('dirA'), 'fichas', 'p1_psicologia'))));

console.log('\nProntuário psicossocial (só psicologia, serviço social, SR e DPP)');
await caso('psicóloga grava o prontuário', aceita(gravar('psiA', [{ col: 'prontuarios', id: 'p1', dados: { pplId: 'p1', valores: { a: 1 }, atendimentos: [] } }])));
await caso('assistente social atualiza o prontuário', aceita(gravar('socA', [{ col: 'prontuarios', id: 'p1', dados: { pplId: 'p1', valores: { a: 2 } }, rev: 2 }])));
await caso('psicóloga lê o prontuário', aceita(getDoc(doc(bd('psiA'), 'prontuarios', 'p1'))));
await caso('psicóloga consulta os prontuários da unidade', aceita(getDocs(query(collection(bd('psiA'), 'prontuarios'), where('unidade', '==', A.unidade), where('sr', '==', A.sr)))));
await caso('chefe de serviço não lê o prontuário', recusa(getDoc(doc(bd('chefeA'), 'prontuarios', 'p1'))));
await caso('diretor(a) não lê o prontuário', recusa(getDoc(doc(bd('dirA'), 'prontuarios', 'p1'))));
await caso('diretor(a) não lê o histórico do prontuário', recusa(getDoc(doc(bd('dirA'), 'prontuarios', 'p1', 'historico', '1'))));
await caso('chefe de serviço não grava prontuário', recusa(gravar('chefeA', [{ col: 'prontuarios', id: 'p5', dados: { pplId: 'p5' } }])));
await caso('psicóloga de outra unidade não lê o prontuário', recusa(getDoc(doc(bd('psiB'), 'prontuarios', 'p1'))));
await caso('SR lê o prontuário da regional', aceita(getDoc(doc(bd('sr1'), 'prontuarios', 'p1'))));

console.log('\nPIP, reclassificação, unidade e composição da CTC');
await caso('membro registra PIP + reclassificação + conclui fase (lote de 3)', aceita(gravar('chefeA', [
  { col: 'pips', id: 'pip1', dados: { pplId: 'p5' } },
  { col: 'reclassificacoes', id: 'r1', dados: { pplId: 'p5', status: 'pendente' } },
  { col: 'fases', id: 'f5', dados: { pplId: 'p5', dataConclusao: '2026-10-23' }, rev: 2 },
])));
await caso('reclassificação não muda de pessoa', recusa(gravar('chefeA', [{ col: 'reclassificacoes', id: 'r1', dados: { pplId: 'p1' }, rev: 2 }])));
await caso('membro não altera a composição da CTC', recusa(gravar('psiA', [{ col: 'membrosCtc', id: 'm1', dados: { nome: 'Fulano', cargo: 'psicologo' } }])));
await caso('diretor(a) altera a composição da CTC', aceita(gravar('dirA', [{ col: 'membrosCtc', id: 'm1', dados: { nome: 'Fulano', cargo: 'psicologo', removido: false } }])));
await caso('membro não altera o tipo de estabelecimento', recusa(gravar('psiA', [{ col: 'unidades', id: 'SR01_x', dados: { nome: A.unidade, tipoEstabelecimento: 'definitivo' } }])));
await caso('diretor(a) altera o tipo de estabelecimento', aceita(gravar('dirA', [{ col: 'unidades', id: 'SR01_x', dados: { nome: A.unidade, tipoEstabelecimento: 'porta_entrada' } }])));

console.log('\nImportação (lotes de 4 registros, como o index.html)');
await caso('lote de 4 pessoas', aceita(gravar('dirA', ['i1', 'i2', 'i3', 'i4'].map((id) => ({ col: 'pessoas', id, dados: { nome: id, situacao: 'ativo' } })))));
await caso('lote de 4 fichas (SR, cada uma confere a pessoa)', aceita(gravar('sr1', ['i1', 'i2', 'i3', 'i4'].map((id) => ({ col: 'fichas', id: id + '_psicologia', dados: { pplId: id, tipo: 'psicologia' } })))));
await caso('lote misto de 4 (pessoa + 3 ligados a ela)', aceita(gravar('dirA', [
  { col: 'pessoas', id: 'i5', dados: { nome: 'i5', situacao: 'ativo' } },
  { col: 'fases', id: 'i5f', dados: { pplId: 'i5' } },
  { col: 'pips', id: 'i5p', dados: { pplId: 'i5' } },
  { col: 'reclassificacoes', id: 'i5r', dados: { pplId: 'i5' } },
])));

await env.cleanup();
console.log('\n' + (total - falhas) + ' de ' + total + ' casos passaram.');
process.exit(falhas ? 1 : 0);
