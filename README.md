# Restaurant Orders

A local restaurant ordering web app for waiter order-taking, kitchen confirmation, live order tracking, payment closing, and daily paid-sales totals.

## Run

```bash
npm start
```

Open `http://localhost:3000`.

## Views

- `Waiter`: choose waiter/table, add products, send an order to the kitchen, track status, and mark completed orders as paid.
- `Kitchen`: confirm received orders, move them to preparing, and mark them done.
- `Reports`: view paid orders and total money for a selected day.

Data is stored in `data/store.json`.
