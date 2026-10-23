# CTC SC

Ferramenta de apoio às Comissões Técnicas de Classificação do DPP-SC.

- `web/index.html`: versão com banco central (Firebase, projeto `ctc-sc`): login, perfis, dados compartilhados e histórico de alterações. Publicada no Firebase Hosting.
- `ctc-sc-standalone.html`: versão antiga, que salva os dados só no navegador (GitHub Pages). Fica no ar até todas as unidades levarem seus dados para a versão nova (aba "Exportar/Importar" → "Trazer dados da versão antiga").

## Perfis

| Perfil | Vê | Edita | Aprova contas |
|---|---|---|---|
| Membro da CTC | a própria unidade | pessoas, fases, PIP, reclassificações e **só a ficha da própria área** (psicólogo(a) → Ficha 2, assistente social → Ficha 1, psiquiatra/profissional de saúde → Ficha 3, policial penal → Ficha 4) | — |
| Diretor(a) | a própria unidade | o mesmo, menos as Fichas 1–4; mais o tipo de estabelecimento e a composição da CTC | membros da unidade |
| SR | a própria regional (painel da regional) | tudo da regional | membros e diretores(as) da regional |
| DPP | o estado todo (painel estadual) | tudo | qualquer conta |

As regras ficam em `firestore.rules`. Nada é apagado: cada gravação guarda uma cópia em `<coleção>/<id>/historico/<rev>`, e quem salva em cima de uma versão desatualizada é recusado.

## Primeiro DPP

Ninguém aprova a primeira conta DPP pelo site. Depois de se cadastrar pedindo o perfil DPP:

1. Firebase Console → Firestore Database → coleção `usuarios` → documento da sua conta.
2. Mude `perfil` para `DPP` (texto) e `status` para `ATIVO`.

A partir daí, as outras contas são aprovadas pela aba "Contas" do site.

## Testes (emulador local, nunca o banco real)

Precisa de Java 11+ no PATH. Na pasta `scripts`: `npm install`. Depois, na pasta do projeto:

```bash
npx firebase-tools@13 emulators:exec --only firestore "node scripts/testar-regras.mjs"
```

Para usar o site com contas de teste: `npx firebase-tools@13 emulators:start`, depois `node scripts/semear-emulador.mjs`, e abra http://localhost:5000 (em localhost o site usa os emuladores sozinho).

## Publicar

```bash
npx firebase-tools@13 login
npx firebase-tools@13 deploy --only firestore:rules,hosting
```
