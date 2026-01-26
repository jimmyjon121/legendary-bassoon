<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Interactive Map for Clinicians</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" integrity="sha384-1BmE4kWBq78iYhFldvKuhfTAU6auU8tT94WrHftjDbrCEXSU1oBoqyl2QvZ6jIW3" crossorigin="anonymous">
  </head>
  <body>
    <div class="container mt-5">
      <h1>Interactive Map for Clinicians</h1>
      <p>Search for treatment programs by location, type of program, or other criteria.</p>
      <form>
        <label for="search">Search:</label>
        <input type="text" id="search" name="search" placeholder="Enter search terms..." />
        <button type="submit">Submit</button>
      </form>
      <div id="map"></div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.production.min.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/react-dom@18.0.0/umd/react-dom.production.min.js" crossorigin="anonymous"></script>
  </body>
</html>