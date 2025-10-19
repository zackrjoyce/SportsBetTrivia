class GameDataHandler {
  constructor(gameData) {
    this.game = gameData.map(this.setGame);
  }

  setGame(game) {
    return {
      id: user.id,
      fullName: `${user.first_name} ${user.last_name}`,
      email: user.email,
      isActive: user.status === 'active',
    };
  }

  getActiveUsers() {
    return this.game.filter(game => game.isActive);
  }

  getEmails() {
    return this.game.map(game => game.email);
  }

  getById(id) {
    return this.game.find(game => game.id === id);
  }
}

export default GameDataHandler;