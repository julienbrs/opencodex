# Démarrage persistant de la cohabitation

Le LaunchAgent `com.opencodex.proxy` démarre le fork OpenCodex au login et le relance après un arrêt.
Il utilise Bun embarqué par l'application Codex Web GPT et le checkout OpenCodex de cohabitation.

Installe ou répare les fichiers locaux sans interrompre le proxy actuel :

```sh
cohab install
```

Après la tâche Codex en cours, bascule une seule fois le proxy démarré dans un terminal vers le LaunchAgent :

```sh
cohab adopt
```

Ensuite le proxy démarre au prochain login. Les commandes courantes sont :

```sh
cohab status
cohab start
cohab logs
```

`cohab start` ouvre le lanceur Web si nécessaire, puis démarre OpenCodex avec launchd. Il ne modifie pas la configuration Codex.
