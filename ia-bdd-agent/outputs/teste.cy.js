describe("Login", () => {

  beforeEach(() => {
    cy.visit("/login");
  });

  it("Login com sucesso", () => {
    cy.get('input[type=email]').type('user@email.com');
    cy.get('input[type=password]').type('123456');
    cy.get('button[type=submit]').click();

    cy.url().should('include', '/dashboard');
  });

  it("Senha incorreta", () => {
    cy.get('input[type=email]').type('user@email.com');
    cy.get('input[type=password]').type('senhaerrada');
    cy.get('button[type=submit]').click();

    cy.contains('Credenciais inválidas').should('be.visible');
  });

  it("Campos vazios", () => {
    cy.get('button[type=submit]').click();

    cy.contains('Campo obrigatório').should('be.visible');
  });

  it("Email inválido", () => {
    cy.get('input[type=email]').type('emailinvalido');
    cy.get('input[type=password]').type('123456');
    cy.get('button[type=submit]').click();

    cy.contains('Email inválido').should('be.visible');
  });

});